import {
  ApiAuthError,
  assertAgentClientAccess,
  assertAgentCountryAccess,
  authenticateAgentRequest,
  respondAuthError,
  supabaseRestRequest,
} from '../supabaseAuth.js';
import { verifySanClientMonthPaid } from '../paymentReconciliation.js';
import { normalizePbxTranscriptReviewForStorage } from '../pbxTranscript.js';
import {
  getPbxUsernameFromEmail,
  isPbxDateKeyAllowed,
  parsePbxCallDateTime,
  pbxCallMatchesSelection,
  verifyPbxCall,
} from '../pbx.js';

const MAX_RECEIPT_BYTES = 50 * 1024 * 1024;
const RECEIPT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
type Country = 'SV' | 'GT';

function parseBody(body: unknown): Record<string, any> | null {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, any>;
  }
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function getCurrentMonthKey(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}

function getTodayKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

async function receiptExists(context: Awaited<ReturnType<typeof authenticateAgentRequest>>, path: string) {
  const segments = path.split('/');
  const filename = segments.at(-1) || '';
  const folder = segments.slice(0, -1).join('/');
  const response = await fetch(
    `${context.supabaseUrl}/storage/v1/object/list/${encodeURIComponent('comprobantes-pago')}`,
    {
      method: 'POST',
      headers: {
        apikey: context.serviceRoleKey,
        Authorization: `Bearer ${context.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefix: folder, limit: 100, offset: 0, search: filename }),
      cache: 'no-store',
    },
  );
  if (!response.ok) return false;
  const objects = await response.json().catch(() => null);
  return Array.isArray(objects) && objects.some((object) => object?.name === filename);
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (String(req.method || '').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const context = await authenticateAgentRequest(req);
    const body = parseBody(req.body);
    if (!body) return res.status(400).json({ success: false, error: 'INVALID_JSON' });

    const country = text(body.pais).toUpperCase() as Country;
    const clientCode = text(body.codigo_cliente, 80).toUpperCase();
    const month = text(body.mes, 7);
    const paymentDate = text(body.fecha_pago, 10);
    const paidBy = text(body.persona_pago, 120);
    const scheduledDate = text(body.fecha_agenda, 10);
    const channel = text(body.tipo_gestion, 40);
    const notes = text(body.observaciones, 5000);
    const receipt = body.comprobante && typeof body.comprobante === 'object' ? body.comprobante : {};
    const receiptPath = text(receipt.path, 500);
    const receiptName = text(receipt.nombre, 255);
    const receiptMime = text(receipt.tipo, 100);
    const receiptSize = Number(receipt.tamano);
    const allowedChannels = new Set(['Llamada', 'WhatsApp', 'Email', 'Visita']);

    if (country !== 'SV' && country !== 'GT') {
      return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
    }
    assertAgentCountryAccess(context, country);
    if (!clientCode || !/^[A-Z0-9_-]+$/.test(clientCode)) {
      return res.status(400).json({ success: false, error: 'INVALID_CLIENT' });
    }
    await assertAgentClientAccess(context, country, clientCode);

    if (month !== getCurrentMonthKey()) {
      return res.status(409).json({
        success: false,
        error: 'PAYMENT_MONTH_NOT_CURRENT',
        message: 'El pago realizado solo se registra para el mes actual.',
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || paymentDate > getTodayKey()) {
      return res.status(400).json({ success: false, error: 'INVALID_PAYMENT_DATE' });
    }
    if (paidBy.length < 2) {
      return res.status(400).json({ success: false, error: 'PAYER_REQUIRED' });
    }
    if (!allowedChannels.has(channel)) {
      return res.status(400).json({ success: false, error: 'INVALID_MANAGEMENT_CHANNEL' });
    }
    const submittedValues = body.valores_dinamicos && typeof body.valores_dinamicos === 'object'
      && !Array.isArray(body.valores_dinamicos)
      ? body.valores_dinamicos as Record<string, any>
      : {};
    let verifiedPbxCall: Awaited<ReturnType<typeof verifyPbxCall>> = null;
    let verifiedPbxDate = '';
    let pbxCallOmitted = false;
    if (channel === 'Llamada') {
      const submittedCall = submittedValues.pbxCall && typeof submittedValues.pbxCall === 'object'
        ? submittedValues.pbxCall as Record<string, unknown>
        : {};
      const uniqueId = text(submittedCall.uniqueId, 160);
      const searchedPhone = text(submittedCall.searchedPhone, 100);
      verifiedPbxDate = text(submittedCall.date, 10);
      const username = getPbxUsernameFromEmail(context.agent.email);
      const selectedExtension = text(submittedCall.extension, 12);
      const localAuditId = text(submittedValues.localAuditId, 160);
      if (
        !uniqueId
        || searchedPhone.replace(/\D/g, '').length < 8
        || !/^\d{4}-\d{2}-\d{2}$/.test(verifiedPbxDate)
        || !isPbxDateKeyAllowed(verifiedPbxDate)
        || !selectedExtension
        || !username
        || !localAuditId
      ) {
        throw new ApiAuthError(
          'Selecciona una llamada PBX válida y el teléfono de destino antes de guardar un pago por llamada.',
          422,
          'PBX_CALL_REQUIRED',
        );
      }

      verifiedPbxCall = await verifyPbxCall(verifiedPbxDate, country, uniqueId, username);
      if (!pbxCallMatchesSelection(verifiedPbxCall, {
        uniqueId,
        ...submittedCall,
        extension: selectedExtension,
        username,
        destination: searchedPhone,
        durationSeconds: submittedCall.durationSeconds,
      })) {
        throw new ApiAuthError(
          'La llamada seleccionada no coincide con el agente, teléfono o duración. No se guardó el pago.',
          409,
          'PBX_CALL_INVALID',
        );
      }

      const existingCallParams = new URLSearchParams({
        select: 'id,valores_dinamicos,clientes!inner(codigo,pais)',
        agente_id: `eq.${context.agent.id}`,
        limit: '10',
      });
      existingCallParams.set('valores_dinamicos->pbxCall->>uniqueId', `eq.${uniqueId}`);
      const { body: existingCallRows } = await supabaseRestRequest(
        `bitacora_gestiones?${existingCallParams.toString()}`,
        {},
        context,
      );
      if (!Array.isArray(existingCallRows)) {
        throw new ApiAuthError('No se pudo comprobar si la llamada ya está vinculada a otra gestión.', 502, 'PBX_CALL_DUPLICATE_CHECK_FAILED');
      }
      const sameRequest = existingCallRows.find((row) => {
        const values = row.valores_dinamicos && typeof row.valores_dinamicos === 'object'
          ? row.valores_dinamicos as Record<string, unknown>
          : {};
        return text(values.localAuditId, 160) === localAuditId
          && String(row.clientes?.codigo || '').toUpperCase() === clientCode
          && String(row.clientes?.pais || '').toUpperCase() === country;
      });
      if (sameRequest) {
        return res.status(200).json({
          success: true,
          alreadyRegistered: true,
          id: String(sameRequest.id || ''),
          estado: 'Resuelto',
          pais: country,
          codigo_cliente: clientCode,
          mes: month,
        });
      }
      if (existingCallRows.length > 0) {
        throw new ApiAuthError(
          'Esta llamada PBX ya está vinculada a otra gestión. Selecciona la llamada correcta.',
          409,
          'PBX_CALL_ALREADY_LINKED',
        );
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
      return res.status(400).json({ success: false, error: 'INVALID_SCHEDULED_DATE' });
    }
    if (!RECEIPT_TYPES.has(receiptMime) || !Number.isInteger(receiptSize) || receiptSize < 1 || receiptSize > MAX_RECEIPT_BYTES) {
      return res.status(400).json({ success: false, error: 'INVALID_RECEIPT' });
    }

    const receiptSegments = receiptPath.split('/');
    const expectedPrefix = `${country}/${clientCode}/${context.agent.id}/`;
    if (
      !receiptPath.startsWith(expectedPrefix)
      || receiptSegments.length !== 4
      || receiptSegments.some((segment: string) => !segment || segment === '.' || segment === '..')
    ) {
      return res.status(400).json({ success: false, error: 'INVALID_RECEIPT_PATH' });
    }
    if (!(await receiptExists(context, receiptPath))) {
      return res.status(400).json({ success: false, error: 'RECEIPT_NOT_UPLOADED' });
    }

    const sanVerification = await verifySanClientMonthPaid(country, clientCode, month);
    if (!sanVerification.verified) {
      return res.status(409).json({
        success: false,
        error: 'SAN_MONTH_NOT_PAID',
        message: 'SAN ya no confirma $0.00 pendiente en las facturas emitidas este mes. Actualiza el cliente y vuelve a verificar.',
      });
    }

    const clientParams = new URLSearchParams({
      select: 'id',
      codigo: `eq.${clientCode}`,
      pais: `eq.${country}`,
      limit: '1',
    });
    const { body: clientRows } = await supabaseRestRequest(`clientes?${clientParams.toString()}`, {}, context);
    if (!Array.isArray(clientRows) || !clientRows[0]?.id) {
      return res.status(404).json({ success: false, error: 'CLIENT_NOT_FOUND' });
    }

    const scheduledValues = submittedValues;
    const verifiedCallDateTime = verifiedPbxCall ? parsePbxCallDateTime(verifiedPbxCall.dateTime) : null;
    const transcriptAvailableAfter = verifiedCallDateTime
      ? new Date(verifiedCallDateTime.getTime() + 24 * 60 * 60 * 1000).toISOString()
      : undefined;
    const values = {
      ...scheduledValues,
      ...(verifiedPbxCall ? {
        localAuditId: text(scheduledValues.localAuditId, 160),
        pbxCall: {
          uniqueId: verifiedPbxCall.uniqueId,
          extension: verifiedPbxCall.extension,
          username: verifiedPbxCall.username,
          date: verifiedPbxDate,
          dateTime: verifiedPbxCall.dateTime,
          origin: verifiedPbxCall.origin,
          destination: verifiedPbxCall.destination,
          searchedPhone: text((scheduledValues.pbxCall as Record<string, unknown>).searchedPhone, 100),
          durationSeconds: verifiedPbxCall.durationSeconds,
          state: verifiedPbxCall.state,
          recordingFile: verifiedPbxCall.recordingFile,
        },
        pbxTranscriptReview: normalizePbxTranscriptReviewForStorage(
          scheduledValues.pbxTranscriptReview,
          verifiedPbxCall.uniqueId,
          transcriptAvailableAfter || '',
        ),
      } : {}),
      estado: 'Resuelto',
      paymentOutcome: 'payment_received',
      paymentDate,
      paymentMadeBy: paidBy,
      paymentEvidencePath: receiptPath,
      paymentEvidenceName: receiptName,
      paymentEvidenceMime: receiptMime,
      paymentEvidenceSize: receiptSize,
      paymentSanVerifiedAt: new Date().toISOString(),
      paymentSanMonthAmount: sanVerification.amount,
      scheduledForDate: scheduledDate,
      periodMonth: month,
      contactChannel: channel,
    };

    let recordId: string;
    try {
      const { body: rpcResult } = await supabaseRestRequest('rpc/register_payment_management', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          p_cliente_id: clientRows[0].id,
          p_agente_id: context.agent.id,
          p_tipo_gestion: channel,
          p_observaciones: notes,
          p_valores_dinamicos: values,
          p_pais: country,
          p_codigo_cliente: clientCode,
          p_mes_periodo: month,
          p_monto_recuperado: sanVerification.amount,
        }),
      }, context);
      recordId = typeof rpcResult === 'string'
        ? rpcResult
        : String(rpcResult?.id || rpcResult?.record_id || '');
      if (!recordId) throw new Error('RPC_RESULT_INVALID');
    } catch {
      return res.status(503).json({
        success: false,
        error: 'PAYMENT_SETUP_REQUIRED',
        message: 'No se completó el registro. Ejecuta primero el SQL de pago realizado y vuelve a intentarlo.',
      });
    }

    return res.status(200).json({
      success: true,
      id: recordId,
      estado: 'Resuelto',
      pais: country,
      codigo_cliente: clientCode,
      mes: month,
      monto_recuperado: sanVerification.amount,
      pbxCallOmitted,
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
