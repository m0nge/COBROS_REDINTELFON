import {
  ApiAuthError,
  assertAgentCountryAccess,
  authenticateAgentRequest,
  getAssignedClientCodes,
  respondAuthError,
  supabaseRestRequest,
} from '../supabaseAuth.js';
import {
  fetchPbxCalls,
  getPbxCallAgentMatch,
  pbxCallMatchesSelection,
  getPbxUsernameFromEmail,
  isPbxDateKeyAllowed,
  parsePbxCallDateTime,
  pbxPhonesMatch,
  type PbxCall,
} from '../pbx.js';
import { normalizePbxTranscriptReviewForStorage } from '../pbxTranscript.js';

type Country = 'SV' | 'GT';
type AuditInput = Record<string, unknown>;
export type PreparedRecord = {
  sourceId: string;
  clientCode: string;
  clientId: string;
  scheduledForDate: string;
  createdAt: string;
  channel: 'Llamada' | 'WhatsApp' | 'Email' | 'Visita';
  agreement: string;
  row: Record<string, unknown>;
};

const AGREEMENTS = new Set([
  'Promesa de Pago',
  'Negociación de Cuotas',
  'Sin Acuerdo',
  'Disputa de Factura',
  'No Aplica',
]);

function parseBody(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dateKey(value: unknown): string {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function validDateOnly(value: unknown): string | null {
  const date = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function normalizeChannel(value: unknown): PreparedRecord['channel'] | null {
  const channel = text(value).toLowerCase();
  if (channel === 'whatsapp' || channel === 'script mensaje') return 'WhatsApp';
  if (channel === 'email' || channel === 'correo') return 'Email';
  if (channel === 'visita') return 'Visita';
  if (channel === 'llamada' || channel === 'llamada telefónica' || channel === 'llamada telefonica') {
    return 'Llamada';
  }
  return null;
}

export function resolvePersistedChannel(
  recordChannel: unknown,
  contactSuccessValue: unknown,
  dynamicValues: unknown,
): PreparedRecord['channel'] | null {
  const values = dynamicValues && typeof dynamicValues === 'object'
    ? dynamicValues as Record<string, unknown>
    : {};
  const explicitContactChannel = normalizeChannel(values.contactChannel)
    || normalizeChannel(values.tipo_gestion);
  const channelFromRecord = normalizeChannel(recordChannel);

  // A successful-contact channel is authoritative, so a WhatsApp promise
  // cannot be mislabeled if an older client sent a stale record.channel.
  if (normalizeContact(contactSuccessValue) === 'Si' && explicitContactChannel) {
    return explicitContactChannel;
  }
  return channelFromRecord || explicitContactChannel;
}

function normalizeContact(value: unknown): 'Si' | 'No' | 'Sin respuesta' | null {
  const contact = text(value).toLowerCase();
  if (contact === 'sí' || contact === 'si') return 'Si';
  if (contact === 'no') return 'No';
  if (contact === 'sin respuesta') return 'Sin respuesta';
  return null;
}

function normalizeState(value: unknown): string | undefined {
  const allowed = new Set([
    'Pendiente',
    'No Contactado',
    'Contactado',
    'Reprogramado',
    'Resuelto',
    'Escalado',
  ]);
  const state = text(value);
  return allowed.has(state) ? state : undefined;
}

function belongsToAuthenticatedAgent(record: AuditInput, context: any): boolean {
  const agentId = text(record.agentId);
  const agentName = text(record.agentName).toLocaleLowerCase();
  const agentEmail = text(record.agentEmail).toLocaleLowerCase();
  return agentId === context.agent.id
    || Boolean(agentEmail && agentEmail === String(context.agent.email || '').toLocaleLowerCase())
    || Boolean(agentName && agentName === String(context.agent.nombre || '').toLocaleLowerCase());
}

function isPaymentSummary(record: AuditInput): boolean {
  const values = record.dynamicValues && typeof record.dynamicValues === 'object'
    ? record.dynamicValues as Record<string, unknown>
    : {};
  return values.summaryOnly === true
    || values.paymentOutcome === 'payment_received'
    || text(record.agreement).toLocaleLowerCase() === 'pago realizado';
}

async function loadClientIds(
  country: Country,
  codes: string[],
  context: any,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let index = 0; index < codes.length; index += 100) {
    const params = new URLSearchParams({
      select: 'id,codigo',
      pais: `eq.${country}`,
      codigo: `in.(${codes.slice(index, index + 100).join(',')})`,
      limit: '1000',
    });
    const { body } = await supabaseRestRequest(`clientes?${params.toString()}`, {}, context);
    if (!Array.isArray(body)) throw new Error('CLIENT_LOOKUP_INVALID');
    for (const row of body) {
      const code = text(row.codigo).toUpperCase();
      const id = text(row.id);
      if (code && id) result.set(code, id);
    }
  }
  return result;
}

async function loadExistingRows(
  clientIds: string[],
  agentId: string,
  context: any,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < clientIds.length; index += 100) {
    const ids = clientIds.slice(index, index + 100);
    for (let offset = 0; ; offset += 1000) {
      const params = new URLSearchParams({
        select: 'id,cliente_id,agente_id,tipo_gestion,acuerdo,created_at,valores_dinamicos',
        cliente_id: `in.(${ids.join(',')})`,
        agente_id: `eq.${agentId}`,
        order: 'created_at.desc',
        limit: '1000',
        offset: String(offset),
      });
      const { body } = await supabaseRestRequest(`bitacora_gestiones?${params.toString()}`, {}, context);
      if (!Array.isArray(body)) throw new Error('AUDIT_LOOKUP_INVALID');
      rows.push(...body);
      if (body.length < 1000) break;
    }
  }
  return rows;
}

async function findExistingPbxCall(
  uniqueId: string,
  agentId: string,
  context: any,
): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams({
    select: 'id,valores_dinamicos',
    agente_id: `eq.${agentId}`,
    limit: '10',
  });
  params.set('valores_dinamicos->pbxCall->>uniqueId', `eq.${uniqueId}`);
  const { body } = await supabaseRestRequest(`bitacora_gestiones?${params.toString()}`, {}, context);
  if (!Array.isArray(body)) throw new Error('PBX_CALL_LOOKUP_INVALID');
  return body;
}

export function isAlreadyStored(
  record: PreparedRecord,
  existing: Array<Record<string, unknown>>,
  codeById: Map<string, string>,
): boolean {
  return existing.some((row) => {
    if (String(row.agente_id || '') !== String(record.row.agente_id || '')) return false;
    if (codeById.get(String(row.cliente_id || '')) !== record.clientCode) return false;
    const values = row.valores_dinamicos && typeof row.valores_dinamicos === 'object'
      ? row.valores_dinamicos as Record<string, unknown>
      : {};
    // The stable client-generated ID is the idempotency key. A time-window
    // heuristic can silently swallow a distinct management for the same client.
    return text(values.localAuditId) === record.sourceId;
  });
}

export function isClientDateAlreadyManaged(
  clientId: string,
  scheduledForDate: string,
  rows: Array<Record<string, unknown>>,
): boolean {
  return rows.some((row) => {
    if (String(row.cliente_id || '') !== clientId) return false;
    const values = row.valores_dinamicos && typeof row.valores_dinamicos === 'object'
      ? row.valores_dinamicos as Record<string, unknown>
      : {};
    const rowDate = text(values.scheduledForDate);
    return rowDate.slice(0, 10) === scheduledForDate
      || dateKey(row.created_at) === scheduledForDate;
  });
}

function elSalvadorDayRange(date: string): { from: string; to: string } {
  const [year, month, day] = date.split('-').map(Number);
  const start = Date.UTC(year, month - 1, day, 6);
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function findClientDateManagement(
  clientId: string,
  scheduledForDate: string,
  todayDate: string,
  context: any,
): Promise<boolean> {
  const columns = 'id,cliente_id,created_at,valores_dinamicos';
  const dynamicDateParams = new URLSearchParams({
    select: columns,
    cliente_id: `eq.${clientId}`,
    limit: '1',
  });
  dynamicDateParams.set('valores_dinamicos->>scheduledForDate', `eq.${scheduledForDate}`);
  const { body: dynamicDateRows } = await supabaseRestRequest(
    `bitacora_gestiones?${dynamicDateParams.toString()}`,
    {},
    context,
  );
  if (!Array.isArray(dynamicDateRows)) {
    throw new ApiAuthError(
      'No se pudo comprobar si el cliente ya tiene una gestión en ese día. No se guardó otra.',
      502,
      'CLIENT_DATE_MANAGEMENT_LOOKUP_FAILED',
    );
  }
  if (isClientDateAlreadyManaged(clientId, scheduledForDate, dynamicDateRows)) return true;

  const { from, to } = elSalvadorDayRange(todayDate);
  const createdTodayParams = new URLSearchParams({
    select: columns,
    cliente_id: `eq.${clientId}`,
    and: `(created_at.gte.${from},created_at.lt.${to})`,
    limit: '1',
  });
  const { body: createdTodayRows } = await supabaseRestRequest(
    `bitacora_gestiones?${createdTodayParams.toString()}`,
    {},
    context,
  );
  if (!Array.isArray(createdTodayRows)) {
    throw new ApiAuthError(
      'No se pudo comprobar si el cliente ya tiene una gestión hoy. No se guardó otra.',
      502,
      'CLIENT_DATE_MANAGEMENT_LOOKUP_FAILED',
    );
  }
  return isClientDateAlreadyManaged(clientId, todayDate, createdTodayRows);
}

export function verifyInsertedRows(
  pending: PreparedRecord[],
  inserted: unknown,
): number {
  const expectedBySourceId = new Map(pending.map((record) => [record.sourceId, record]));
  if (!Array.isArray(inserted) || inserted.length !== pending.length) {
    throw new ApiAuthError(
      'La base de datos no confirmó todas las gestiones. No se marcaron como guardadas.',
      502,
      'DATABASE_WRITE_NOT_CONFIRMED',
    );
  }

  const confirmedIds = new Set<string>();
  for (const row of inserted) {
    if (!row || typeof row !== 'object') {
      throw new ApiAuthError(
        'La base de datos devolvió una confirmación incompleta. No se marcó la gestión como guardada.',
        502,
        'DATABASE_WRITE_NOT_CONFIRMED',
      );
    }
    const insertedRow = row as Record<string, unknown>;
    const values = insertedRow.valores_dinamicos && typeof insertedRow.valores_dinamicos === 'object'
      ? insertedRow.valores_dinamicos as Record<string, unknown>
      : {};
    const sourceId = text(values.localAuditId);
    const expected = expectedBySourceId.get(sourceId);
    if (
      !expected
      || confirmedIds.has(sourceId)
      || String(insertedRow.agente_id || '') !== String(expected.row.agente_id || '')
      || String(insertedRow.cliente_id || '') !== String(expected.clientId)
    ) {
      throw new ApiAuthError(
        'La base de datos devolvió una confirmación que no coincide con la gestión enviada.',
        502,
        'DATABASE_WRITE_NOT_CONFIRMED',
      );
    }
    confirmedIds.add(sourceId);
  }

  if (confirmedIds.size !== pending.length) {
    throw new ApiAuthError(
      'La base de datos no confirmó todas las gestiones. No se marcaron como guardadas.',
      502,
      'DATABASE_WRITE_NOT_CONFIRMED',
    );
  }
  return confirmedIds.size;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (String(req.method || '').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const context = await authenticateAgentRequest(req);
    if (context.agent.rol !== 'agente') {
      return res.status(403).json({ success: false, error: 'AGENT_REQUIRED' });
    }
    const body = parseBody(req.body);
    if (!body) return res.status(400).json({ success: false, error: 'INVALID_JSON' });

    const country = text(body.pais).toUpperCase() as Country;
    const mode = text(body.mode);
    const isLocalStorageSync = text(body.source) !== 'live';
    const records = Array.isArray(body.records) ? body.records as AuditInput[] : [];
    if (country !== 'SV' && country !== 'GT') {
      return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
    }
    if (mode !== 'preview' && mode !== 'commit') {
      return res.status(400).json({ success: false, error: 'INVALID_MODE' });
    }
    if (records.length < 1 || records.length > 200) {
      return res.status(400).json({ success: false, error: 'RECORD_COUNT_INVALID' });
    }
    assertAgentCountryAccess(context, country);

    const assignedCodes = await getAssignedClientCodes(context);
    const prepared: PreparedRecord[] = [];
    let skippedCount = 0;
    let pbxCallOmittedCount = 0;
    const seenIds = new Set<string>();
    const seenLiveClientDates = new Set<string>();
    const pbxCallsByDate = new Map<string, PbxCall[]>();

    for (const record of records) {
      const sourceId = text(record.id);
      const clientCode = text(record.clientCode).toUpperCase();
      const createdAt = text(record.timestamp);
      const timestamp = new Date(createdAt);
      const values = record.dynamicValues && typeof record.dynamicValues === 'object'
        ? record.dynamicValues as Record<string, unknown>
        : {};
      const contactSuccess = normalizeContact(record.contactSuccess);
      const channel = resolvePersistedChannel(record.channel, contactSuccess, values);
      const agreement = text(record.agreement);
      const scheduledForDate = validDateOnly(record.scheduledForDate)
        || validDateOnly(values.scheduledForDate)
        || dateKey(createdAt);

      if (
        !sourceId
        || seenIds.has(sourceId)
        || !clientCode
        || !assignedCodes.has(clientCode)
        || text(record.country).toUpperCase() !== country
        || !belongsToAuthenticatedAgent(record, context)
        || Number.isNaN(timestamp.getTime())
        || !channel
        || !contactSuccess
        || !AGREEMENTS.has(agreement)
        || record.aiVerdict === 'Inválida'
      ) {
        skippedCount += 1;
        continue;
      }
      seenIds.add(sourceId);
      if (isPaymentSummary(record)) {
        // Payments must go through the SAN-verifying payment endpoint.
        skippedCount += 1;
        continue;
      }
      if (!isLocalStorageSync) {
        const clientDateKey = `${country}:${clientCode}:${scheduledForDate}`;
        if (seenLiveClientDates.has(clientDateKey)) {
          throw new ApiAuthError(
            `El cliente ${clientCode} ya tiene una gestión en la agenda del ${scheduledForDate}. No se guardó otra.`,
            409,
            'CLIENT_ALREADY_MANAGED_FOR_DATE',
          );
        }
        seenLiveClientDates.add(clientDateKey);
      }

      let verifiedPbxCall: PbxCall | null = null;
      let verifiedPbxDate = '';
      const submittedPbxCall = values.pbxCall && typeof values.pbxCall === 'object'
        ? values.pbxCall as Record<string, unknown>
        : {};
      if (!isLocalStorageSync && channel === 'Llamada') {
        const uniqueId = text(submittedPbxCall.uniqueId);
        const searchedPhone = text(submittedPbxCall.searchedPhone);
        if (!uniqueId || searchedPhone.replace(/\D/g, '').length < 8) {
          throw new ApiAuthError(
            'Selecciona una llamada PBX válida y el teléfono de destino antes de guardar como llamada.',
            422,
            'PBX_CALL_REQUIRED',
          );
        }
        let keepPbxCall = true;
        try {
          verifiedPbxDate = validDateOnly(submittedPbxCall.date) || '';
          const selectedExtension = text(submittedPbxCall.extension);
          const expectedUsername = getPbxUsernameFromEmail(context.agent.email);
          const profileExtension = String(context.agent.extension_pbx || '').trim();
          if (
            !verifiedPbxDate
            || !isPbxDateKeyAllowed(verifiedPbxDate)
            || !uniqueId
            || !selectedExtension
            || (!expectedUsername && !profileExtension)
          ) {
            keepPbxCall = false;
          } else {
            let dayCalls = pbxCallsByDate.get(verifiedPbxDate);
            if (!dayCalls) {
              dayCalls = await fetchPbxCalls(verifiedPbxDate, country);
              pbxCallsByDate.set(verifiedPbxDate, dayCalls);
            }
            verifiedPbxCall = dayCalls.find((call) =>
              call.uniqueId === uniqueId
              && getPbxCallAgentMatch(call, expectedUsername, profileExtension) !== null
            ) || null;
            const submittedDuration = Number(record.durationSeconds);
            if (
              !pbxCallMatchesSelection(verifiedPbxCall, {
                uniqueId,
                ...submittedPbxCall,
                extension: selectedExtension,
                username: verifiedPbxCall?.username,
                destination: searchedPhone,
                durationSeconds: submittedPbxCall.durationSeconds,
              })
              || !Number.isFinite(submittedDuration)
              || submittedDuration !== verifiedPbxCall?.durationSeconds
            ) {
              keepPbxCall = false;
            } else {
              const existingCallRows = await findExistingPbxCall(uniqueId, context.agent.id, context);
              const reusedCall = existingCallRows.some((row) => {
                const existingValues = row.valores_dinamicos && typeof row.valores_dinamicos === 'object'
                  ? row.valores_dinamicos as Record<string, unknown>
                  : {};
                return text(existingValues.localAuditId) !== sourceId;
              });
              if (reusedCall) keepPbxCall = false;
            }
          }
        } catch (error) {
          if (error instanceof ApiAuthError) throw error;
          throw new ApiAuthError(
            'No se pudo volver a verificar la llamada con la PBX. La gestión no se guardó; actualiza la búsqueda e inténtalo de nuevo.',
            502,
            'PBX_CALL_VERIFICATION_FAILED',
          );
        }
        if (!keepPbxCall) {
          throw new ApiAuthError(
            'La llamada seleccionada no coincide con el agente, teléfono o duración, o ya está vinculada a otra gestión. No se guardó.',
            409,
            'PBX_CALL_INVALID_OR_ALREADY_LINKED',
          );
        }
      }

      const submittedDuration = Number(record.durationSeconds);
      const duration = verifiedPbxCall?.durationSeconds
        ?? (channel === 'Llamada' && !isLocalStorageSync
          ? null
          : Number.isFinite(submittedDuration) && submittedDuration >= 0
            ? Math.round(submittedDuration)
            : null);
      const amount = Number(record.committedAmount);
      const state = normalizeState(record.status);
      const callDateTime = verifiedPbxCall ? parsePbxCallDateTime(verifiedPbxCall.dateTime) : null;
      const transcriptAvailableAfter = callDateTime
        ? new Date(callDateTime.getTime() + 24 * 60 * 60 * 1000).toISOString()
        : undefined;
      const dynamicValues = {
        ...values,
        estado: state || values.estado,
        scheduledForDate,
        periodMonth: scheduledForDate.slice(0, 7),
        callRoundLabel: text(record.callRoundLabel) || values.callRoundLabel,
        localAuditId: sourceId,
        ...(isLocalStorageSync ? { migratedFromLocalStorage: true } : {}),
        ...(verifiedPbxCall ? {
          pbxCall: {
            uniqueId: verifiedPbxCall.uniqueId,
            extension: verifiedPbxCall.extension,
            username: verifiedPbxCall.username,
            date: verifiedPbxDate,
            dateTime: verifiedPbxCall.dateTime,
            origin: verifiedPbxCall.origin,
            destination: verifiedPbxCall.destination,
            searchedPhone: text(submittedPbxCall.searchedPhone),
            durationSeconds: verifiedPbxCall.durationSeconds,
            state: verifiedPbxCall.state,
            recordingFile: verifiedPbxCall.recordingFile,
          },
          pbxTranscriptReview: normalizePbxTranscriptReviewForStorage(
            values.pbxTranscriptReview,
            verifiedPbxCall.uniqueId,
            transcriptAvailableAfter || '',
          ),
        } : {}),
      };
      prepared.push({
        sourceId,
        clientCode,
        clientId: '',
        scheduledForDate,
        createdAt: timestamp.toISOString(),
        channel,
        agreement,
        row: {
          agente_id: context.agent.id,
          tipo_gestion: channel,
          contacto_exitoso: contactSuccess,
          acuerdo: agreement,
          duracion_llamada_segundos: duration,
          fecha_limite_pago: validDateOnly(record.deadlineDate),
          monto_comprometido: Number.isFinite(amount) ? amount : 0,
          observaciones: text(record.observations),
          valores_dinamicos: dynamicValues,
          validacion_exitosa: true,
          validacion_llamada_30s: channel !== 'Llamada'
            ? true
            : duration === null
              ? null
              : duration >= 30,
          validacion_campos_completos: true,
          validacion_acuerdo_valido: true,
          created_at: timestamp.toISOString(),
        },
      });
    }

    const codes = [...new Set(prepared.map((record) => record.clientCode))];
    const clientIdByCode = await loadClientIds(country, codes, context);
    const missingClientCodes = codes.filter((code) => !clientIdByCode.has(code));
    const validPrepared = prepared.filter((record) => clientIdByCode.has(record.clientCode));
    skippedCount += prepared.length - validPrepared.length;
    validPrepared.forEach((record) => {
      record.clientId = clientIdByCode.get(record.clientCode)!;
      record.row.cliente_id = record.clientId;
    });

    const clientIds = [...new Set(validPrepared.map((record) => record.clientId))];
    const existingRows = await loadExistingRows(clientIds, context.agent.id, context);
    const codeById = new Map([...clientIdByCode.entries()].map(([code, id]) => [id, code]));
    const todayDate = dateKey(new Date());
    const pending: PreparedRecord[] = [];
    let alreadyPresentCount = 0;
    const pendingClientDates = new Set<string>();
    for (const record of validPrepared) {
      if (isAlreadyStored(record, existingRows, codeById)) {
        alreadyPresentCount += 1;
      } else {
        if (!isLocalStorageSync) {
          const clientDateKey = `${country}:${record.clientId}:${record.scheduledForDate}`;
          if (pendingClientDates.has(clientDateKey)) {
            throw new ApiAuthError(
              `El cliente ${record.clientCode} ya tiene una gestión en la agenda del ${record.scheduledForDate}. No se guardó otra.`,
              409,
              'CLIENT_ALREADY_MANAGED_FOR_DATE',
            );
          }
          if (await findClientDateManagement(record.clientId, record.scheduledForDate, todayDate, context)) {
            throw new ApiAuthError(
              `El cliente ${record.clientCode} ya tiene una gestión registrada para el ${record.scheduledForDate}. Abre la gestión existente; no se guardó otra.`,
              409,
              'CLIENT_ALREADY_MANAGED_FOR_DATE',
            );
          }
          pendingClientDates.add(clientDateKey);
        }
        pending.push(record);
      }
    }

    if (mode === 'preview') {
      return res.status(200).json({
        success: true,
        totalCount: records.length,
        alreadyPresentCount,
        toImportCount: pending.length,
        skippedCount,
        pbxCallOmittedCount,
        missingClientCodes,
      });
    }

    if (pending.length === 0) {
      return res.status(200).json({
        success: true,
        importedCount: 0,
        alreadyPresentCount,
        skippedCount,
        pbxCallOmittedCount,
        missingClientCodes,
      });
    }

    const { body: inserted } = await supabaseRestRequest(
      'bitacora_gestiones',
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(pending.map((record) => record.row)),
      },
      context,
    );
    const importedCount = verifyInsertedRows(pending, inserted);
    return res.status(200).json({
      success: true,
      importedCount,
      alreadyPresentCount,
      skippedCount,
      pbxCallOmittedCount,
      missingClientCodes,
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
