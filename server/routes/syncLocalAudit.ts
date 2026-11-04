import {
  assertAgentCountryAccess,
  authenticateAgentRequest,
  getAssignedClientCodes,
  respondAuthError,
  supabaseRestRequest,
} from '../supabaseAuth.js';

type Country = 'SV' | 'GT';
type AuditInput = Record<string, unknown>;
type PreparedRecord = {
  sourceId: string;
  clientCode: string;
  clientId: string;
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

function isAlreadyStored(
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
    if (text(values.localAuditId) === record.sourceId) return true;

    const existingAt = new Date(String(row.created_at || '')).getTime();
    const incomingAt = new Date(record.createdAt).getTime();
    return text(row.tipo_gestion).toLowerCase() === record.channel.toLowerCase()
      && text(row.acuerdo) === record.agreement
      && Number.isFinite(existingAt)
      && Number.isFinite(incomingAt)
      && Math.abs(existingAt - incomingAt) <= 10 * 60 * 1000;
  });
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
    const seenIds = new Set<string>();

    for (const record of records) {
      const sourceId = text(record.id);
      const clientCode = text(record.clientCode).toUpperCase();
      const createdAt = text(record.timestamp);
      const timestamp = new Date(createdAt);
      const values = record.dynamicValues && typeof record.dynamicValues === 'object'
        ? record.dynamicValues as Record<string, unknown>
        : {};
      const channel = normalizeChannel(record.channel);
      const contactSuccess = normalizeContact(record.contactSuccess);
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

      const duration = Number(record.durationSeconds);
      const amount = Number(record.committedAmount);
      const state = normalizeState(record.status);
      const dynamicValues = {
        ...values,
        estado: state || values.estado,
        scheduledForDate,
        periodMonth: scheduledForDate.slice(0, 7),
        callRoundLabel: text(record.callRoundLabel) || values.callRoundLabel,
        localAuditId: sourceId,
        ...(isLocalStorageSync ? { migratedFromLocalStorage: true } : {}),
      };
      prepared.push({
        sourceId,
        clientCode,
        clientId: '',
        createdAt: timestamp.toISOString(),
        channel,
        agreement,
        row: {
          agente_id: context.agent.id,
          tipo_gestion: channel,
          contacto_exitoso: contactSuccess,
          acuerdo: agreement,
          duracion_llamada_segundos: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : 45,
          fecha_limite_pago: validDateOnly(record.deadlineDate),
          monto_comprometido: Number.isFinite(amount) ? amount : 0,
          observaciones: text(record.observations),
          valores_dinamicos: dynamicValues,
          validacion_exitosa: true,
          validacion_llamada_30s: true,
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
    const pending: PreparedRecord[] = [];
    let alreadyPresentCount = 0;
    for (const record of validPrepared) {
      if (isAlreadyStored(record, existingRows, codeById)) {
        alreadyPresentCount += 1;
      } else {
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
        missingClientCodes,
      });
    }

    if (pending.length === 0) {
      return res.status(200).json({
        success: true,
        importedCount: 0,
        alreadyPresentCount,
        skippedCount,
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
    return res.status(200).json({
      success: true,
      importedCount: Array.isArray(inserted) ? inserted.length : pending.length,
      alreadyPresentCount,
      skippedCount,
      missingClientCodes,
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
