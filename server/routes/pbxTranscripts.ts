import {
  assertAgentClientAccess,
  assertAgentCountryAccess,
  authenticateAgentRequest,
  respondAuthError,
} from '../supabaseAuth.js';
import {
  fetchPbxTranscriptsRange,
  findMatchingPbxTranscript,
  getPbxMonthToDateTranscriptQueryRange,
  getPbxUsernameFromEmail,
  isPbxDateKeyAllowed,
  parsePbxCallDateTime,
  pbxPhoneDigits,
  pbxPhonesMatch,
  verifyPbxCall,
} from '../pbx.js';
import { createPbxTranscriptAutoForm } from '../pbxTranscript.js';

type Country = 'SV' | 'GT';

function queryText(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}

function getPendingMessage(availableAfter: string, now: Date): string {
  return Date.parse(availableAfter) > now.getTime()
    ? 'La transcripción suele estar disponible 24 horas después de la llamada.'
    : 'La transcripción aún no está disponible en la PBX. Se volverá a consultar automáticamente.';
}

export async function pbxTranscriptHandler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const context = await authenticateAgentRequest(req);
    if (context.agent.rol !== 'agente') {
      return res.status(403).json({ success: false, error: 'AGENT_REQUIRED' });
    }
    const country = context.agent.pais as Country;
    assertAgentCountryAccess(context, country);

    const requestedCountry = queryText(req.query?.pais).toUpperCase();
    const clientCode = queryText(req.query?.codigo_cliente).toUpperCase();
    const callId = queryText(req.query?.call_id);
    const callDate = queryText(req.query?.fecha).slice(0, 10);
    const destinationPhone = queryText(req.query?.telefono_destino);
    if (requestedCountry && requestedCountry !== country) {
      return res.status(403).json({ success: false, error: 'COUNTRY_ACCESS_DENIED' });
    }
    if (!clientCode || !callId || !/^\d{4}-\d{2}-\d{2}$/.test(callDate)) {
      return res.status(400).json({ success: false, error: 'CALL_DETAILS_REQUIRED' });
    }
    if (!isPbxDateKeyAllowed(callDate)) {
      return res.status(400).json({ success: false, error: 'INVALID_CALL_DATE' });
    }
    if (pbxPhoneDigits(destinationPhone).length < 8) {
      return res.status(400).json({ success: false, error: 'DESTINATION_PHONE_REQUIRED' });
    }
    await assertAgentClientAccess(context, country, clientCode);

    const extension = String(context.agent.extension_pbx || '').trim();
    const username = getPbxUsernameFromEmail(context.agent.email);
    if (!extension || !username) {
      return res.status(409).json({
        success: false,
        error: 'PBX_AGENT_PROFILE_INCOMPLETE',
        message: 'El perfil del agente necesita extensión PBX y correo configurados.',
      });
    }

    const selectedCall = await verifyPbxCall(callDate, country, callId, extension, username);
    if (!selectedCall || !pbxPhonesMatch(selectedCall.destination, destinationPhone)) {
      return res.status(404).json({
        success: false,
        error: 'PBX_CALL_NOT_FOUND',
        message: 'La llamada ya no coincide con este agente, cliente y teléfono.',
      });
    }

    const callDateTime = parsePbxCallDateTime(selectedCall.dateTime);
    if (!callDateTime) {
      return res.status(502).json({ success: false, error: 'PBX_CALL_DATE_INVALID' });
    }
    const availableAfter = new Date(callDateTime.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const now = new Date();
    if (Date.parse(availableAfter) > now.getTime()) {
      return res.status(200).json({
        success: true,
        status: 'pending',
        availableAfter,
        message: getPendingMessage(availableAfter, now),
      });
    }

    const range = getPbxMonthToDateTranscriptQueryRange(callDate);
    const transcripts = await fetchPbxTranscriptsRange(range.fromDate, range.toDate);
    const transcript = findMatchingPbxTranscript(transcripts, {
      uniqueId: selectedCall.uniqueId,
      country,
      extension,
      username,
      origin: selectedCall.origin,
      destination: selectedCall.destination,
      dateTime: selectedCall.dateTime,
    });
    if (!transcript?.transcript.trim()) {
      return res.status(200).json({
        success: true,
        status: 'pending',
        availableAfter,
        message: getPendingMessage(availableAfter, now),
        queriedRange: range,
      });
    }

    const transcriptText = transcript.transcript.slice(0, 100_000);
    return res.status(200).json({
      success: true,
      status: 'ready_for_review',
      sourceCallId: transcript.uniqueId,
      availableAfter,
      transcriptText,
      transcriptTruncated: transcript.transcript.length > transcriptText.length,
      qualityRating: transcript.qualityRating || '',
      qualitySummary: transcript.qualitySummary || '',
      autoForm: createPbxTranscriptAutoForm(transcript.transcript, country, selectedCall.dateTime),
      queriedRange: range,
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
