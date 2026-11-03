import {
  assertAgentCountryAccess,
  authenticateAgentRequest,
  respondAuthError,
  supabaseRestRequest,
} from '../supabaseAuth.js';

function queryValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('es-SV', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'America/El_Salvador',
      }).format(date);
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('es-SV', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'America/El_Salvador',
      }).format(date);
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const context = await authenticateAgentRequest(req, true);
    const requestedCountry = queryValue(req.query?.pais).toUpperCase();
    const country = (requestedCountry || context.agent.pais) as 'SV' | 'GT';
    if (country !== 'SV' && country !== 'GT') {
      return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
    }
    assertAgentCountryAccess(context, country);

    const rows: any[] = [];
    const pageSize = 1000;
    const maximumRows = 10000;
    for (let offset = 0; offset < maximumRows; offset += pageSize) {
      const params = new URLSearchParams({
        select: 'id,agente_id,tipo_gestion,contacto_exitoso,acuerdo,duracion_llamada_segundos,fecha_limite_pago,monto_comprometido,observaciones,valores_dinamicos,validacion_exitosa,created_at,clientes!inner(codigo,nombre,pais),agentes!inner(nombre,email,extension_pbx,pais)',
        'clientes.pais': `eq.${country}`,
        'agentes.pais': `eq.${country}`,
        order: 'created_at.desc',
        limit: String(pageSize),
        offset: String(offset),
      });
      const { body: page } = await supabaseRestRequest(
        `bitacora_gestiones?${params.toString()}`,
        {},
        context,
      );
      if (!Array.isArray(page)) throw new Error('AUDIT_RESPONSE_INVALID');
      rows.push(...page);
      if (page.length < pageSize) break;
    }

    const records = rows.map((row) => {
      const client = Array.isArray(row.clientes) ? row.clientes[0] : row.clientes;
      const agent = Array.isArray(row.agentes) ? row.agentes[0] : row.agentes;
      const timestamp = String(row.created_at || '');
      const dynamicValues = row.valores_dinamicos && typeof row.valores_dinamicos === 'object'
        ? row.valores_dinamicos
        : {};
      return {
        id: String(row.id),
        timestamp,
        date: formatDate(timestamp),
        time: formatTime(timestamp),
        scheduledForDate: String(dynamicValues.scheduledForDate || ''),
        agentId: String(row.agente_id || ''),
        agentName: String(agent?.nombre || 'Agente'),
        agentEmail: String(agent?.email || ''),
        pbxExtension: String(agent?.extension_pbx || ''),
        clientCode: String(client?.codigo || ''),
        clientName: String(client?.nombre || ''),
        country,
        channel: String(row.tipo_gestion || ''),
        durationSeconds: Number(row.duracion_llamada_segundos) || undefined,
        contactSuccess: String(row.contacto_exitoso || ''),
        agreement: String(row.acuerdo || ''),
        committedAmount: Number(row.monto_comprometido) || undefined,
        deadlineDate: row.fecha_limite_pago || undefined,
        observations: String(row.observaciones || ''),
        aiVerdict: row.validacion_exitosa === true ? 'Válida' : row.validacion_exitosa === false ? 'Inválida' : undefined,
        aiScore: Number(dynamicValues.aiScore) || undefined,
        totalDebt: Number(dynamicValues.totalDebt) || undefined,
        callRoundLabel: String(dynamicValues.callRoundLabel || ''),
        dynamicValues,
        status: String(dynamicValues.estado || ''),
      };
    });

    return res.status(200).json({
      success: true,
      pais: country,
      records,
      truncated: rows.length >= maximumRows,
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
