import { Readable } from 'node:stream';
import {
  assertAgentClientAccess,
  assertAgentCountryAccess,
  authenticateAgentRequest,
  getSupabaseAdminConfig,
  respondAuthError,
  supabaseRestRequest,
} from '../supabaseAuth.js';
import {
  createPbxAudioTicket,
  fetchPbxCalls,
  fetchPbxRecording,
  getPbxUsernameFromEmail,
  isPbxDateKeyAllowed,
  verifyPbxAudioTicket,
} from '../pbx.js';

type Country = 'SV' | 'GT';

function queryText(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}

function phoneDigits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function numbersMatch(left: string, right: string): boolean {
  const a = phoneDigits(left);
  const b = phoneDigits(right);
  if (a.length < 8 || b.length < 8) return false;
  return a === b || a.slice(-8) === b.slice(-8);
}

export async function listPbxCallsHandler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const context = await authenticateAgentRequest(req);
    const country = context.agent.pais as Country;
    assertAgentCountryAccess(context, country);

    const requestedCountry = queryText(req.query?.pais).toUpperCase();
    if (requestedCountry && requestedCountry !== country) {
      return res.status(403).json({ success: false, error: 'COUNTRY_ACCESS_DENIED' });
    }
    const date = queryText(req.query?.fecha);
    if (!isPbxDateKeyAllowed(date)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CALL_DATE',
        message: 'Consulta una fecha entre hoy y los últimos 6 días.',
      });
    }

    const clientCode = queryText(req.query?.codigo_cliente).toUpperCase();
    if (!clientCode) {
      return res.status(400).json({ success: false, error: 'CLIENT_REQUIRED' });
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

    const { body: clients } = await supabaseRestRequest(
      `clientes?select=phone1,phone2,celular&codigo=eq.${encodeURIComponent(clientCode)}&pais=eq.${country}&limit=1`,
      {},
      context,
    );
    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(404).json({ success: false, error: 'CLIENT_NOT_FOUND' });
    }
    const clientPhones = [
      clients[0].phone1,
      clients[0].phone2,
      clients[0].celular,
    ].map((phone) => String(phone || '')).filter(Boolean);

    const calls = await fetchPbxCalls(date, country);
    const agentCalls = calls.filter(
      (call) => call.extension === extension && call.username === username && Boolean(call.uniqueId),
    );
    const { serviceRoleKey } = context;
    const records = agentCalls.map((call) => {
      const ticket = createPbxAudioTicket({
        agentId: context.agent.id,
        country,
        date,
        extension,
        uniqueId: call.uniqueId,
      }, serviceRoleKey);
      const matchesClientPhone = clientPhones.some((phone) =>
        numbersMatch(call.destination, phone) || numbersMatch(call.origin, phone)
      );
      return {
        callId: call.uniqueId,
        extension: call.extension,
        username: call.username,
        dateTime: call.dateTime,
        origin: call.origin,
        destination: call.destination,
        durationSeconds: call.durationSeconds,
        state: call.state,
        recordingFile: call.recordingFile,
        matchesClientPhone,
        audioUrl: `/api/cartera?action=pbx-audio&ticket=${encodeURIComponent(ticket)}`,
      };
    }).sort((left, right) => {
      if (left.matchesClientPhone !== right.matchesClientPhone) {
        return left.matchesClientPhone ? -1 : 1;
      }
      return right.dateTime.localeCompare(left.dateTime);
    });

    return res.status(200).json({
      success: true,
      pais: country,
      fecha: date,
      agente: { extension, usuario: username },
      calls: records,
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}

export async function pbxAudioHandler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { serviceRoleKey } = getSupabaseAdminConfig();
    const ticket = verifyPbxAudioTicket(queryText(req.query?.ticket), serviceRoleKey);
    if (!ticket) {
      return res.status(401).json({ success: false, error: 'AUDIO_TICKET_INVALID_OR_EXPIRED' });
    }

    const range = String(req.headers?.range || '');
    const response = await fetchPbxRecording(ticket, range);
    const contentType = response.headers.get('content-type') || 'audio/wav';
    const contentRange = response.headers.get('content-range');
    const upstreamLength = response.headers.get('content-length');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', response.headers.get('accept-ranges') || 'bytes');
    res.setHeader('Content-Disposition', 'inline');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    if (upstreamLength) res.setHeader('Content-Length', upstreamLength);
    if (!response.body) {
      return res.status(502).json({ success: false, error: 'PBX_AUDIO_EMPTY' });
    }
    return Readable.fromWeb(response.body as any).pipe(res.status(response.status));
  } catch (error) {
    return respondAuthError(res, error);
  }
}
