type Country = 'SV' | 'GT';
type RawClient = Record<string, unknown>;

import {
  authenticateAgentRequest,
  assertAgentCountryAccess,
  getAssignedClientCodes,
  respondAuthError,
  supabaseRestRequest,
} from '../server/supabaseAuth.js';

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result || null;
}

function isActive(raw: RawClient): boolean {
  const status = String(
    raw.estatus || raw.status || raw.estado || raw.Estatus || raw.Status || raw.Estado || '',
  )
    .trim()
    .toUpperCase();
  if (
    status.includes('INACT') ||
    status.includes('BAJA') ||
    status.includes('CANCEL') ||
    status.includes('SUSPEND') ||
    status === 'NO ACTIVO' ||
    status === 'NO'
  ) {
    return false;
  }

  const classification = String(raw.clasificacion || raw.CLASIFICACION || '')
    .trim()
    .toUpperCase();
  return !(
    classification.includes('INACT') ||
    classification.includes('BAJA') ||
    classification.includes('CANCEL')
  );
}

function toClient(raw: RawClient, country: Country) {
  return {
    code: text(raw.Codigo || raw.codigo || raw.code) || '',
    name: text(raw.Nombre || raw.nombre || raw.name) || '',
    address: text(raw.address || raw.direccion),
    phone1: text(raw.phone1),
    phone2: text(raw.phone2),
    cell: text(raw.celular || raw.cell),
    celular: text(raw.celular || raw.cell),
    department: text(raw.departamento),
    municipality: text(raw.municipio),
    email: text(raw.correo || raw.email),
    classification: text(raw.clasificacion),
    salesManager: text(raw.gestorcomercial || raw.gestor_comercial),
    managerEmail: text(raw.emailgestor || raw.email_gestor),
    managerCode: text(raw.codigogestor || raw.codigo_gestor),
    country,
  };
}

function validManagementState(value: unknown): string | undefined {
  const allowed = new Set([
    'Pendiente',
    'No Contactado',
    'Contactado',
    'Reprogramado',
    'Resuelto',
    'Escalado',
  ]);
  const state = String(value || '').trim();
  return allowed.has(state) ? state : undefined;
}

async function loadSharedManagement(
  country: Country,
  visibleCodes: Set<string> | null,
  context: any,
) {
  const assignmentParams = new URLSearchParams({
    select: 'pais,codigo_cliente,agente_id',
    pais: `eq.${country}`,
    order: 'codigo_cliente.asc',
    limit: '5000',
  });
  const { body: assignmentRows } = await supabaseRestRequest(
    `asignaciones_cartera_fija?${assignmentParams}`,
    {},
    context,
  );
  if (!Array.isArray(assignmentRows)) throw new Error('SHARED_ASSIGNMENTS_INVALID');

  const agentsByCode = new Map<string, Set<string>>();
  for (const row of assignmentRows) {
    if (String(row.pais || '').trim().toUpperCase() !== country) continue;
    const code = String(row.codigo_cliente || '').trim().toUpperCase();
    const agentId = String(row.agente_id || '').trim();
    if (!code || !agentId || (visibleCodes && !visibleCodes.has(code))) continue;
    const assignedAgents = agentsByCode.get(code) || new Set<string>();
    assignedAgents.add(agentId);
    agentsByCode.set(code, assignedAgents);
  }

  const sharedCodes = new Set(
    [...agentsByCode.entries()]
      .filter(([, agentIds]) => agentIds.size > 1)
      .map(([code]) => code),
  );
  const historyByCode = new Map<string, Array<Record<string, unknown>>>();
  if (sharedCodes.size === 0) return { sharedCodes, historyByCode };

  const sharedClientRows: Array<{ id: string; codigo: string }> = [];
  const codeList = [...sharedCodes];
  for (let index = 0; index < codeList.length; index += 100) {
    const params = new URLSearchParams({
      select: 'id,codigo',
      pais: `eq.${country}`,
      codigo: `in.(${codeList.slice(index, index + 100).join(',')})`,
      limit: '1000',
    });
    const { body } = await supabaseRestRequest(`clientes?${params}`, {}, context);
    if (!Array.isArray(body)) throw new Error('SHARED_CLIENTS_INVALID');
    sharedClientRows.push(...body);
  }

  const codeByClientId = new Map<string, string>();
  for (const client of sharedClientRows) {
    const id = String(client.id || '');
    const code = String(client.codigo || '').trim().toUpperCase();
    if (id && code && sharedCodes.has(code)) codeByClientId.set(id, code);
  }

  const clientIds = [...codeByClientId.keys()];
  for (let index = 0; index < clientIds.length; index += 100) {
    const ids = clientIds.slice(index, index + 100);
    for (let offset = 0; ; offset += 1000) {
      const params = new URLSearchParams({
        select: 'id,cliente_id,agente_id,created_at,tipo_gestion,contacto_exitoso,acuerdo,monto_comprometido,fecha_limite_pago,observaciones,valores_dinamicos,validacion_exitosa',
        cliente_id: `in.(${ids.join(',')})`,
        validacion_exitosa: 'eq.true',
        order: 'created_at.desc,id.desc',
        limit: '1000',
        offset: String(offset),
      });
      const { body } = await supabaseRestRequest(`bitacora_gestiones?${params}`, {}, context);
      if (!Array.isArray(body)) throw new Error('SHARED_MANAGEMENT_INVALID');
      for (const row of body) {
        const code = codeByClientId.get(String(row.cliente_id || ''));
        const at = text(row.created_at);
        if (!code || !at) continue;
        const values = row.valores_dinamicos && typeof row.valores_dinamicos === 'object'
          ? row.valores_dinamicos as Record<string, unknown>
          : {};
        const state = validManagementState(values.estado)
          || (String(row.contacto_exitoso || '').toLocaleLowerCase() === 'si'
            ? 'Contactado'
            : 'Reprogramado');
        const records = historyByCode.get(code) || [];
        records.push({
          id: String(row.id || `${code}:${at}`),
          at,
          agentId: String(row.agente_id || ''),
          channel: text(row.tipo_gestion) || undefined,
          agreement: text(row.acuerdo) || undefined,
          contactSuccess: text(row.contacto_exitoso) || undefined,
          state,
          scheduledForDate: text(values.scheduledForDate) || undefined,
          dynamicValues: values,
          committedAmount: Number(row.monto_comprometido) || undefined,
          deadlineDate: text(row.fecha_limite_pago) || undefined,
          promiseTime: text(values.promiseTime) || undefined,
          contactName: text(values.contactName) || undefined,
          contactPhone: text(values.contactPhone) || undefined,
          contactEmail: text(values.contactEmail) || undefined,
          observations: text(row.observaciones) || undefined,
        });
        historyByCode.set(code, records);
      }
      if (body.length < 1000) break;
    }
  }

  return { sharedCodes, historyByCode };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  let context;
  try {
    context = await authenticateAgentRequest(req);
  } catch (error) {
    return respondAuthError(res, error);
  }

  const queryCountry = String(req.query?.pais || context.agent.pais).toUpperCase();
  if (queryCountry !== 'SV' && queryCountry !== 'GT') {
    return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
  }
  const country = queryCountry as Country;
  try {
    assertAgentCountryAccess(context, country);
  } catch (error) {
    return respondAuthError(res, error);
  }

  let assignedClientCodes: Set<string> | null = null;
  if (context.agent.rol !== 'admin') {
    try {
      assignedClientCodes = await getAssignedClientCodes(context);
    } catch (error) {
      return respondAuthError(res, error);
    }
  }

  const sapKey = process.env.SAP_API_KEY;
  if (!sapKey) {
    return res.status(503).json({ success: false, error: 'SAP_NOT_CONFIGURED' });
  }

  const url = new URL('https://sapapi.red.com.sv/api/Cliente/clienteasignado');
  url.searchParams.set('var_pais', country);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'X-API-KEY': sapKey, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return res.status(502).json({
        success: false,
        error: 'SAP_UPSTREAM_FAILED',
        upstreamStatus: response.status,
      });
    }

    const rawRows = await response.json();
    if (!Array.isArray(rawRows)) {
      return res.status(502).json({ success: false, error: 'SAP_RESPONSE_INVALID' });
    }

    let sharedManagement: Awaited<ReturnType<typeof loadSharedManagement>>;
    try {
      sharedManagement = await loadSharedManagement(country, assignedClientCodes, context);
    } catch {
      return res.status(502).json({
        success: false,
        error: 'SHARED_ASSIGNMENT_STATE_UNAVAILABLE',
        message: 'No se pudo actualizar el estado de la cartera compartida; intenta refrescar de nuevo.',
      });
    }

    const clients = (rawRows as RawClient[])
      .filter((client) => client && typeof client === 'object' && isActive(client))
      .map((client) => toClient(client, country))
      .filter((client) => (
        context.agent.rol === 'admin'
        || Boolean(assignedClientCodes?.has(String(client.code).trim().toUpperCase()))
      ))
      .map((client) => {
        const code = String(client.code).trim().toUpperCase();
        if (!sharedManagement.sharedCodes.has(code)) return client;
        const history = sharedManagement.historyByCode.get(code) || [];
        const latest = history[0];
        return {
          ...client,
          isSharedAssignment: true,
          sharedManagementHistory: history,
          ...(latest ? {
            state: latest.state,
            lastManagementDate: latest.at,
            lastManagementType: latest.channel,
          } : {}),
        };
      });

    return res.status(200).json({
      success: true,
      count: clients.length,
      pais: country,
      lastSync: new Date().toISOString(),
      clients,
    });
  } catch {
    return res.status(502).json({ success: false, error: 'SAP_REQUEST_FAILED' });
  } finally {
    clearTimeout(timeout);
  }
}
