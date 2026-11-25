import {
  ApiAuthError,
  assertAgentClientAccess,
  assertAgentCountryAccess,
  authenticateAgentRequest,
  respondAuthError,
  supabaseRestRequest,
} from '../supabaseAuth.js';

type Country = 'SV' | 'GT';

export const MIN_ATTEMPTS_TO_ESCALATE = 2;
const CHANNELS = new Set(['Llamada', 'WhatsApp', 'Email', 'Visita']);
const AGREEMENTS = new Set(['Promesa de Pago', 'Negociación de Cuotas', 'Sin Acuerdo', 'Disputa de Factura', 'No Aplica']);
const CLOSED_STATES = new Set(['Cerrado']);
export const INITIAL_CRITICAL_REASON = 'Importación inicial: cliente crítico con más de 120 días de mora';

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function queryValue(value: unknown): string {
  return Array.isArray(value) ? text(value[0]) : text(value);
}

function parseBody(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function elSalvadorDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function loadClient(country: Country, clientCode: string, context: any) {
  const params = new URLSearchParams({
    select: 'id,codigo,nombre,total_deuda,dias_mora',
    pais: `eq.${country}`,
    codigo: `eq.${clientCode}`,
    limit: '1',
  });
  const { body } = await supabaseRestRequest(`clientes?${params}`, {}, context);
  const client = Array.isArray(body) ? body[0] : null;
  if (!client?.id) throw new ApiAuthError('No se encontró el cliente en la cartera.', 404, 'CLIENT_NOT_FOUND');
  return client as Record<string, unknown>;
}

async function loadOpenEscalation(clientId: string, context: any) {
  const params = new URLSearchParams({
    select: 'id,agente_id,estado,created_at',
    cliente_id: `eq.${clientId}`,
    order: 'created_at.desc',
    limit: '1',
  });
  const { body } = await supabaseRestRequest(`escalaciones_criticas?${params}`, {}, context);
  const row = Array.isArray(body) ? body[0] : null;
  return row && !CLOSED_STATES.has(text(row.estado)) ? row as Record<string, unknown> : null;
}

async function escalate(context: any, country: Country, body: Record<string, unknown>) {
  if (context.agent.rol !== 'agente') {
    throw new ApiAuthError('Solo un gestor de cobros puede escalar un cliente.', 403, 'AGENT_REQUIRED');
  }
  const clientCode = text(body.codigo_cliente).toUpperCase();
  await assertAgentClientAccess(context, country, clientCode);
  const client = await loadClient(country, clientCode, context);
  const clientId = text(client.id);

  const existing = await loadOpenEscalation(clientId, context);
  if (existing) return { escalation: existing, alreadyEscalated: true };

  const attemptParams = new URLSearchParams({
    select: 'id',
    cliente_id: `eq.${clientId}`,
    agente_id: `eq.${context.agent.id}`,
    validacion_exitosa: 'not.is.false',
    limit: String(MIN_ATTEMPTS_TO_ESCALATE),
  });
  const { body: attempts } = await supabaseRestRequest(`bitacora_gestiones?${attemptParams}`, {}, context);
  if (!Array.isArray(attempts) || attempts.length < MIN_ATTEMPTS_TO_ESCALATE) {
    throw new ApiAuthError(
      'Solo puedes escalar un cliente después de gestionarlo al menos dos veces.',
      409,
      'NOT_ENOUGH_ATTEMPTS',
    );
  }

  const { body: inserted } = await supabaseRestRequest('escalaciones_criticas', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      cliente_id: clientId,
      agente_id: context.agent.id,
      monto_deuda: Number(client.total_deuda) || 0,
      dias_mora: Math.max(0, Math.round(Number(client.dias_mora) || 0)),
      departamento_destino: 'Administración de Cobros',
      motivo: text(body.motivo).slice(0, 1000) || null,
      estado: 'Escalado',
    }),
  }, context);
  return { escalation: Array.isArray(inserted) ? inserted[0] : null, alreadyEscalated: false };
}

async function importCriticalClients(context: any, country: Country, body: Record<string, unknown>) {
  if (context.agent.rol !== 'admin') {
    throw new ApiAuthError('Se requiere un perfil de administrador.', 403, 'ADMIN_REQUIRED');
  }
  if (!Array.isArray(body.clientes) || body.clientes.length > 6) {
    throw new ApiAuthError('Envía hasta 6 clientes críticos.', 400, 'INVALID_CRITICAL_CLIENTS');
  }

  const imported: string[] = [];
  for (const item of body.clientes) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    const clientCode = text(candidate.codigo_cliente).toUpperCase();
    const agentId = text(candidate.agente_id);
    if (!clientCode || !agentId) continue;

    const agentParams = new URLSearchParams({
      select: 'id',
      id: `eq.${agentId}`,
      pais: `eq.${country}`,
      rol: 'eq.agente',
      limit: '1',
    });
    const { body: agentRows } = await supabaseRestRequest(`agentes?${agentParams}`, {}, context);
    if (!Array.isArray(agentRows) || agentRows.length === 0) {
      throw new ApiAuthError('El gestor no existe en el país seleccionado.', 404, 'AGENT_NOT_FOUND');
    }
    const assignmentParams = new URLSearchParams({
      select: 'codigo_cliente',
      pais: `eq.${country}`,
      agente_id: `eq.${agentId}`,
      codigo_cliente: `eq.${clientCode}`,
      limit: '1',
    });
    const { body: assignments } = await supabaseRestRequest(
      `asignaciones_cartera_fija?${assignmentParams}`,
      {},
      context,
    );
    if (!Array.isArray(assignments) || assignments.length === 0) {
      throw new ApiAuthError(
        `El gestor seleccionado no tiene asignado al cliente ${clientCode}.`,
        403,
        'CLIENT_AGENT_MISMATCH',
      );
    }
    const client = await loadClient(country, clientCode, context);
    if (Number(client.dias_mora) <= 120) continue;
    const clientId = text(client.id);
    const existingParams = new URLSearchParams({
      select: 'id',
      cliente_id: `eq.${clientId}`,
      limit: '1',
    });
    const { body: existing } = await supabaseRestRequest(
      `escalaciones_criticas?${existingParams}`,
      {},
      context,
    );
    if (Array.isArray(existing) && existing.length > 0) continue;

    await supabaseRestRequest('escalaciones_criticas', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        cliente_id: clientId,
        agente_id: agentId,
        monto_deuda: Number(client.total_deuda) || 0,
        dias_mora: Math.max(0, Math.round(Number(client.dias_mora) || 0)),
        departamento_destino: 'Administración de Cobros',
        motivo: INITIAL_CRITICAL_REASON,
        estado: 'Escalado',
      }),
    }, context);
    imported.push(clientCode);
  }
  return { imported };
}

async function manageEscalation(context: any, country: Country, body: Record<string, unknown>) {
  if (context.agent.rol !== 'admin') {
    throw new ApiAuthError('Se requiere un perfil de administrador.', 403, 'ADMIN_REQUIRED');
  }
  const clientCode = text(body.codigo_cliente).toUpperCase();
  const client = await loadClient(country, clientCode, context);
  const escalation = await loadOpenEscalation(text(client.id), context);
  if (!escalation) {
    throw new ApiAuthError('El administrador solo puede gestionar clientes escalados.', 403, 'CLIENT_NOT_ESCALATED');
  }

  const channel = text(body.canal);
  const contact = text(body.contacto_exitoso) === 'Si' ? 'Si' : 'No';
  const agreement = contact === 'Si' ? text(body.acuerdo) : 'Sin Acuerdo';
  if (!CHANNELS.has(channel) || !AGREEMENTS.has(agreement)) {
    throw new ApiAuthError('Selecciona un canal y un acuerdo válidos.', 400, 'INVALID_MANAGEMENT');
  }
  const isPromise = agreement === 'Promesa de Pago' || agreement === 'Negociación de Cuotas';
  const today = elSalvadorDateKey();
  const promiseDate = text(body.fecha_promesa).slice(0, 10);
  const amount = Number(body.monto_comprometido);
  if (isPromise && (!/^\d{4}-\d{2}-\d{2}$/.test(promiseDate) || promiseDate < today)) {
    throw new ApiAuthError('La fecha de la promesa debe ser hoy o una fecha futura.', 400, 'INVALID_PROMISE_DATE');
  }
  if (isPromise && !(amount > 0)) {
    throw new ApiAuthError('Ingresa el monto prometido.', 400, 'INVALID_PROMISE_AMOUNT');
  }

  const now = new Date().toISOString();
  const { body: inserted } = await supabaseRestRequest('bitacora_gestiones', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      cliente_id: client.id,
      agente_id: context.agent.id,
      tipo_gestion: channel,
      contacto_exitoso: contact,
      acuerdo: agreement,
      duracion_llamada_segundos: null,
      fecha_limite_pago: isPromise ? promiseDate : null,
      monto_comprometido: isPromise ? amount : 0,
      observaciones: text(body.observaciones).slice(0, 4000),
      valores_dinamicos: {
        source: 'escalado',
        escalationId: escalation.id,
        estado: contact === 'Si' ? 'Contactado' : 'No Contactado',
        scheduledForDate: today,
        periodMonth: today.slice(0, 7),
        callRoundLabel: 'Gestión de escalado',
        localAuditId: `escalado-${escalation.id}-${Date.now()}`,
      },
      validacion_exitosa: true,
      validacion_llamada_30s: true,
      validacion_campos_completos: true,
      validacion_acuerdo_valido: true,
      created_at: now,
    }),
  }, context);

  await supabaseRestRequest(`escalaciones_criticas?id=eq.${encodeURIComponent(text(escalation.id))}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: isPromise ? 'Promesa pendiente' : 'En gestión' }),
  }, context);

  return { management: Array.isArray(inserted) ? inserted[0] : null };
}

async function closeEscalation(context: any, country: Country, body: Record<string, unknown>) {
  if (context.agent.rol !== 'admin') {
    throw new ApiAuthError('Se requiere un perfil de administrador.', 403, 'ADMIN_REQUIRED');
  }
  const client = await loadClient(country, text(body.codigo_cliente).toUpperCase(), context);
  const escalation = await loadOpenEscalation(text(client.id), context);
  if (!escalation) return { closed: false };
  await supabaseRestRequest(`escalaciones_criticas?id=eq.${encodeURIComponent(text(escalation.id))}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'Cerrado' }),
  }, context);
  return { closed: true };
}

async function listEscalations(context: any, country: Country) {
  const params = new URLSearchParams({
    select: 'id,agente_id,monto_deuda,dias_mora,motivo,estado,created_at,clientes!inner(id,codigo,nombre,pais),agentes(nombre)',
    'clientes.pais': `eq.${country}`,
    order: 'created_at.desc',
    limit: '1000',
  });
  if (context.agent.rol !== 'admin') params.set('agente_id', `eq.${context.agent.id}`);
  const { body } = await supabaseRestRequest(`escalaciones_criticas?${params}`, {}, context);
  const rows = Array.isArray(body) ? body : [];

  const managementsByClient = new Map<string, Array<Record<string, unknown>>>();
  const clientIds = [...new Set(rows.map((row: any) => {
    const client = Array.isArray(row.clientes) ? row.clientes[0] : row.clientes;
    return text(client?.id);
  }).filter(Boolean))];
  if (context.agent.rol === 'admin') {
    for (let index = 0; index < clientIds.length; index += 100) {
      const managementParams = new URLSearchParams({
        select: 'id,cliente_id,tipo_gestion,contacto_exitoso,acuerdo,fecha_limite_pago,monto_comprometido,observaciones,valores_dinamicos,created_at,agentes(nombre)',
        cliente_id: `in.(${clientIds.slice(index, index + 100).join(',')})`,
        order: 'created_at.desc',
        limit: '1000',
      });
      managementParams.set('valores_dinamicos->>source', 'eq.escalado');
      const { body: managementRows } = await supabaseRestRequest(`bitacora_gestiones?${managementParams}`, {}, context);
      (Array.isArray(managementRows) ? managementRows : []).forEach((row: any) => {
        const list = managementsByClient.get(text(row.cliente_id)) || [];
        list.push(row);
        managementsByClient.set(text(row.cliente_id), list);
      });
    }
  }

  return rows.map((row: any) => {
    const client = Array.isArray(row.clientes) ? row.clientes[0] : row.clientes;
    const agent = Array.isArray(row.agentes) ? row.agentes[0] : row.agentes;
    const createdAt = Date.parse(text(row.created_at)) || 0;
    const managements = (managementsByClient.get(text(client?.id)) || [])
      .filter((management) => (Date.parse(text(management.created_at)) || 0) >= createdAt)
      .map((management: any) => {
        const values = management.valores_dinamicos && typeof management.valores_dinamicos === 'object'
          ? management.valores_dinamicos
          : {};
        const managedBy = Array.isArray(management.agentes) ? management.agentes[0] : management.agentes;
        return {
          id: text(management.id),
          createdAt: text(management.created_at),
          managedBy: text(managedBy?.nombre),
          channel: text(management.tipo_gestion),
          contactSuccess: text(management.contacto_exitoso),
          agreement: text(management.acuerdo),
          promiseDate: text(management.fecha_limite_pago).slice(0, 10),
          committedAmount: Number(management.monto_comprometido) || 0,
          observations: text(management.observaciones),
          promiseVerificationStatus: text(values.promiseVerificationStatus),
          promiseVerifiedAt: text(values.promiseVerifiedAt),
        };
      });
    return {
      id: text(row.id),
      clientCode: text(client?.codigo),
      clientName: text(client?.nombre),
      escalatedById: text(row.agente_id),
      escalatedByName: text(agent?.nombre) || 'Gestor',
      escalatedAt: text(row.created_at),
      debtAtEscalation: Number(row.monto_deuda) || 0,
      daysArrearsAtEscalation: Number(row.dias_mora) || 0,
      reason: text(row.motivo),
      status: text(row.estado) || 'Escalado',
      managements,
    };
  });
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  const method = String(req.method || '').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const context = await authenticateAgentRequest(req);
    const body = method === 'POST' ? parseBody(req.body) : {};
    if (!body) return res.status(400).json({ success: false, error: 'INVALID_JSON' });
    const country = (text(method === 'POST' ? body.pais : queryValue(req.query?.pais)).toUpperCase()
      || context.agent.pais) as Country;
    if (country !== 'SV' && country !== 'GT') {
      return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
    }
    assertAgentCountryAccess(context, country);

    if (method === 'GET') {
      return res.status(200).json({ success: true, escalations: await listEscalations(context, country) });
    }
    const operation = text(body.operacion);
    if (operation === 'escalar') return res.status(200).json({ success: true, ...(await escalate(context, country, body)) });
    if (operation === 'importar-criticos') {
      return res.status(200).json({ success: true, ...(await importCriticalClients(context, country, body)) });
    }
    if (operation === 'gestionar') return res.status(200).json({ success: true, ...(await manageEscalation(context, country, body)) });
    if (operation === 'cerrar') return res.status(200).json({ success: true, ...(await closeEscalation(context, country, body)) });
    return res.status(400).json({ success: false, error: 'INVALID_OPERATION' });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
