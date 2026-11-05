import {
  ApiAuthError,
  assertAgentCountryAccess,
  authenticateAgentRequest,
  respondAuthError,
  supabaseRestRequest,
} from '../supabaseAuth.js';
import {
  getPbxUsernameFromEmail,
  isPbxDateKeyAllowed,
  pbxCallMatchesSelection,
  parsePbxCallDateTime,
  verifyPbxCall,
} from '../pbx.js';
import { normalizePbxTranscriptReviewForStorage } from '../pbxTranscript.js';
import { verifySanClientMonthPaid } from '../paymentReconciliation.js';

type Country = 'SV' | 'GT';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNELS = new Set(['Llamada', 'WhatsApp', 'Email', 'Visita']);
const AGREEMENTS = new Set([
  'Promesa de Pago',
  'Negociación de Cuotas',
  'Pago realizado',
  'Sin Acuerdo',
  'Disputa de Factura',
  'No Aplica',
]);

function parseBody(body: unknown): Record<string, any> | null {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, any>;
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function text(value: unknown, max = 5000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validDate(value: unknown, allowEmpty = false): string | null {
  const date = text(value, 10);
  if (allowEmpty && !date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function getCurrentMonthKey(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
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

    const recordId = text(body.id, 80);
    const country = text(body.pais, 2).toUpperCase() as Country;
    const clientCode = text(body.codigo_cliente, 80).toUpperCase();
    const channel = text(body.tipo_gestion, 40);
    const contactRaw = text(body.contacto_exitoso, 40).toLowerCase();
    const contact = contactRaw === 'sí' || contactRaw === 'si'
      ? 'Si'
      : contactRaw === 'no'
        ? 'No'
        : contactRaw === 'sin respuesta'
          ? 'Sin respuesta'
          : '';
    const agreement = text(body.acuerdo, 60);
    const rawDeadlineDate = text(body.fecha_limite_pago, 10);
    const deadlineDate = validDate(body.fecha_limite_pago, true);
    const amount = body.monto_comprometido === null || body.monto_comprometido === ''
      ? 0
      : Number(body.monto_comprometido);
    const duration = body.duracion_llamada_segundos === null
      || body.duracion_llamada_segundos === undefined
      || body.duracion_llamada_segundos === ''
      ? null
      : Number(body.duracion_llamada_segundos);
    const observations = text(body.observaciones);
    const submittedValues = body.valores_dinamicos && typeof body.valores_dinamicos === 'object'
      && !Array.isArray(body.valores_dinamicos)
      ? body.valores_dinamicos as Record<string, any>
      : null;

    if (!UUID_PATTERN.test(recordId)) {
      return res.status(400).json({ success: false, error: 'INVALID_MANAGEMENT_ID' });
    }
    if (country !== 'SV' && country !== 'GT') {
      return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
    }
    assertAgentCountryAccess(context, country);
    if (!clientCode || !/^[A-Z0-9_-]+$/.test(clientCode)) {
      return res.status(400).json({ success: false, error: 'INVALID_CLIENT' });
    }
    if (
      !CHANNELS.has(channel)
      || !contact
      || !AGREEMENTS.has(agreement)
      || !submittedValues
      || (rawDeadlineDate && !deadlineDate)
    ) {
      return res.status(400).json({ success: false, error: 'INVALID_MANAGEMENT_FIELDS' });
    }
    if (!Number.isFinite(amount) || amount < 0 || amount > 999999999) {
      return res.status(400).json({ success: false, error: 'INVALID_COMMITTED_AMOUNT' });
    }
    if (duration !== null && (!Number.isInteger(duration) || duration < 0 || duration > 86400)) {
      return res.status(400).json({ success: false, error: 'INVALID_CALL_DURATION' });
    }
    if (observations.length > 5000) {
      return res.status(400).json({ success: false, error: 'OBSERVATIONS_TOO_LONG' });
    }

    const existingParams = new URLSearchParams({
      select: 'id,agente_id,cliente_id,acuerdo,valores_dinamicos,clientes!inner(codigo,pais),agentes!inner(email,extension_pbx)',
      id: `eq.${recordId}`,
      limit: '1',
    });
    const { body: existingRows } = await supabaseRestRequest(
      `bitacora_gestiones?${existingParams}`,
      {},
      context,
    );
    const existing = Array.isArray(existingRows) ? existingRows[0] : null;
    const client = Array.isArray(existing?.clientes) ? existing.clientes[0] : existing?.clientes;
    const savedAgent = Array.isArray(existing?.agentes) ? existing.agentes[0] : existing?.agentes;
    if (
      !existing
      || String(client?.codigo || '').toUpperCase() !== clientCode
      || String(client?.pais || '').toUpperCase() !== country
    ) {
      throw new ApiAuthError('La gestión ya no existe o no pertenece al cliente indicado.', 404, 'MANAGEMENT_NOT_FOUND');
    }
    if (context.agent.rol !== 'admin' && String(existing.agente_id || '') !== context.agent.id) {
      throw new ApiAuthError('Solo puedes editar tus propias gestiones.', 403, 'MANAGEMENT_EDIT_FORBIDDEN');
    }

    const oldValues = existing.valores_dinamicos && typeof existing.valores_dinamicos === 'object'
      ? existing.valores_dinamicos as Record<string, any>
      : {};
    const values: Record<string, any> = {
      ...submittedValues,
      localAuditId: oldValues.localAuditId,
      scheduledForDate: validDate(submittedValues.scheduledForDate)
        || validDate(oldValues.scheduledForDate)
        || getCurrentMonthKey() + '-01',
      periodMonth: text(submittedValues.periodMonth, 7),
      contactChannel: channel,
      tipo_gestion: channel,
      estado: agreement === 'Pago realizado' ? 'Resuelto' : contact === 'Si' ? 'Contactado' : 'Reprogramado',
    };

    const submittedCall = submittedValues.pbxCall && typeof submittedValues.pbxCall === 'object'
      ? submittedValues.pbxCall as Record<string, unknown>
      : null;
    const oldCall = oldValues.pbxCall && typeof oldValues.pbxCall === 'object'
      ? oldValues.pbxCall as Record<string, unknown>
      : null;
    let verifiedDuration = duration;
    if (channel === 'Llamada' && submittedCall?.uniqueId) {
      const uniqueId = text(submittedCall.uniqueId, 160);
      const callDate = validDate(submittedCall.date);
      const searchedPhone = text(submittedCall.searchedPhone, 100);
      if (oldCall?.uniqueId === uniqueId) {
        values.pbxCall = oldCall;
      } else {
        const targetAgentEmail = String(savedAgent?.email || '');
        const targetAgentExtension = String(savedAgent?.extension_pbx || '');
        const username = getPbxUsernameFromEmail(targetAgentEmail);
        if (
          !callDate
          || !isPbxDateKeyAllowed(callDate)
          || !searchedPhone
          || searchedPhone.replace(/\D/g, '').length < 8
          || !username
        ) {
          throw new ApiAuthError('La llamada PBX seleccionada no es válida. Busca y selecciona nuevamente la llamada.', 422, 'PBX_CALL_REQUIRED');
        }
        const verifiedCall = await verifyPbxCall(callDate, country, uniqueId, username, targetAgentExtension);
        if (!verifiedCall || !pbxCallMatchesSelection(verifiedCall, {
          uniqueId,
          ...submittedCall,
          extension: submittedCall.extension,
          username: verifiedCall?.username,
          destination: searchedPhone,
          durationSeconds: submittedCall.durationSeconds,
        })) {
          throw new ApiAuthError('La llamada no coincide con la extensión, teléfono o agente de esta gestión.', 409, 'PBX_CALL_INVALID');
        }
        const duplicateParams = new URLSearchParams({
          select: 'id,valores_dinamicos',
          agente_id: `eq.${existing.agente_id}`,
          limit: '10',
        });
        duplicateParams.set('valores_dinamicos->pbxCall->>uniqueId', `eq.${uniqueId}`);
        const { body: duplicateRows } = await supabaseRestRequest(
          `bitacora_gestiones?${duplicateParams}`,
          {},
          context,
        );
        if (!Array.isArray(duplicateRows)) {
          throw new ApiAuthError('No se pudo comprobar si la llamada ya está vinculada a otra gestión.', 502, 'PBX_CALL_DUPLICATE_CHECK_FAILED');
        }
        if (duplicateRows.some((row) => String(row.id || '') !== recordId)) {
          throw new ApiAuthError('Esta llamada PBX ya está vinculada a otra gestión.', 409, 'PBX_CALL_ALREADY_LINKED');
        }
        const callDateTime = parsePbxCallDateTime(verifiedCall.dateTime);
        const transcriptAvailableAfter = callDateTime
          ? new Date(callDateTime.getTime() + 24 * 60 * 60 * 1000).toISOString()
          : '';
        verifiedDuration = verifiedCall.durationSeconds;
        values.pbxCall = {
          uniqueId: verifiedCall.uniqueId,
          extension: verifiedCall.extension,
          username: verifiedCall.username,
          date: callDate,
          dateTime: verifiedCall.dateTime,
          origin: verifiedCall.origin,
          destination: verifiedCall.destination,
          searchedPhone,
          durationSeconds: verifiedCall.durationSeconds,
          state: verifiedCall.state,
          recordingFile: verifiedCall.recordingFile,
        };
        values.pbxTranscriptReview = normalizePbxTranscriptReviewForStorage(
          submittedValues.pbxTranscriptReview,
          verifiedCall.uniqueId,
          transcriptAvailableAfter,
        );
      }
    } else if (channel !== 'Llamada') {
      delete values.pbxCall;
      delete values.pbxTranscriptReview;
      verifiedDuration = null;
    } else if (oldCall) {
      values.pbxCall = oldCall;
      verifiedDuration = Number(oldCall.durationSeconds) || verifiedDuration;
    } else {
      delete values.pbxCall;
      delete values.pbxTranscriptReview;
    }

    if (agreement === 'Pago realizado') {
      const paymentDate = validDate(values.paymentDate);
      const payer = text(values.paymentMadeBy, 120);
      const evidencePath = text(values.paymentEvidencePath, 500);
      const month = text(values.periodMonth, 7);
      const alreadyPaid = String(existing.acuerdo || '') === 'Pago realizado';
      const ownerPrefix = `${country}/${clientCode}/${existing.agente_id}/`;
      if (
        !paymentDate
        || payer.length < 2
        || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
        || (!alreadyPaid && month !== getCurrentMonthKey())
        || !evidencePath.startsWith(ownerPrefix)
        || evidencePath.split('/').length !== 4
      ) {
        throw new ApiAuthError('Para marcar el pago adjunta un comprobante y completa fecha, persona y mes actual.', 422, 'PAYMENT_DETAILS_REQUIRED');
      }
      if (!(await receiptExists(context, evidencePath))) {
        throw new ApiAuthError('El comprobante no está disponible en el servidor. Vuelve a adjuntarlo antes de guardar.', 422, 'RECEIPT_NOT_UPLOADED');
      }
      if (!alreadyPaid) {
        const sanVerification = await verifySanClientMonthPaid(country, clientCode, month);
        if (!sanVerification.verified) {
          throw new ApiAuthError(
            'SAN no confirma que el saldo del mes actual esté pagado. Actualiza el cliente y vuelve a verificar antes de marcarlo.',
            409,
            'SAN_MONTH_NOT_PAID',
          );
        }
        values.paymentSanVerifiedAt = new Date().toISOString();
        values.paymentSanMonthAmount = sanVerification.amount;
      }
      values.paymentOutcome = 'payment_received';
    } else {
      delete values.paymentOutcome;
      delete values.paymentDate;
      delete values.paymentMadeBy;
      delete values.paymentEvidencePath;
      delete values.paymentEvidenceName;
      delete values.paymentEvidenceMime;
      delete values.paymentEvidenceSize;
      delete values.paymentSanVerifiedAt;
      delete values.paymentSanMonthAmount;
    }

    const scheduledForDate = validDate(values.scheduledForDate);
    if (!scheduledForDate) {
      throw new ApiAuthError('La fecha de agenda de la gestión no es válida.', 422, 'INVALID_SCHEDULED_DATE');
    }
    if (agreement !== 'Pago realizado') values.periodMonth = scheduledForDate.slice(0, 7);
    values.estado = agreement === 'Pago realizado'
      ? 'Resuelto'
      : contact === 'Si' ? 'Contactado' : 'Reprogramado';

    const { body: updatedId } = await supabaseRestRequest('rpc/update_management_record', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        p_record_id: recordId,
        p_actor_id: context.agent.id,
        p_actor_is_admin: context.agent.rol === 'admin',
        p_tipo_gestion: channel,
        p_contacto_exitoso: contact,
        p_acuerdo: agreement,
        p_fecha_limite_pago: agreement === 'Pago realizado' ? null : deadlineDate,
        p_monto_comprometido: agreement === 'Pago realizado' ? 0 : amount,
        p_observaciones: observations,
        p_valores_dinamicos: values,
        p_duracion_llamada_segundos: verifiedDuration,
        p_validacion_exitosa: body.validacion_exitosa !== false,
      }),
    }, context);

    const savedId = typeof updatedId === 'string'
      ? updatedId
      : String(updatedId?.id || updatedId?.record_id || '');
    if (savedId !== recordId) {
      throw new ApiAuthError('El servidor no confirmó la actualización de la gestión.', 502, 'MANAGEMENT_UPDATE_NOT_CONFIRMED');
    }

    return res.status(200).json({ success: true, id: savedId });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
