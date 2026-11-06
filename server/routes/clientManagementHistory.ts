import {
  assertAgentClientAccess,
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

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const context = await authenticateAgentRequest(req);
    const requestedCountry = queryValue(req.query?.pais).trim().toUpperCase();
    const country = (requestedCountry || context.agent.pais) as 'SV' | 'GT';
    const clientCode = queryValue(req.query?.codigo_cliente).trim().toUpperCase();

    if (country !== 'SV' && country !== 'GT') {
      return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
    }
    assertAgentCountryAccess(context, country);
    await assertAgentClientAccess(context, country, clientCode);

    const clientParams = new URLSearchParams({
      select: 'id,codigo,nombre',
      pais: `eq.${country}`,
      codigo: `eq.${clientCode}`,
      limit: '1',
    });
    const { body: clients } = await supabaseRestRequest(`clientes?${clientParams.toString()}`, {}, context);
    const client = Array.isArray(clients) ? clients[0] : undefined;
    if (!client?.id) {
      return res.status(404).json({ success: false, error: 'CLIENT_NOT_FOUND' });
    }

    const records: Array<Record<string, unknown>> = [];
    const pageSize = 500;
    const maximumRows = 10_000;
    for (let offset = 0; offset < maximumRows; offset += pageSize) {
      const params = new URLSearchParams({
        select: 'id,agente_id,tipo_gestion,contacto_exitoso,acuerdo,duracion_llamada_segundos,fecha_limite_pago,monto_comprometido,observaciones,valores_dinamicos,validacion_exitosa,created_at,agentes!inner(nombre,email,extension_pbx,pais)',
        cliente_id: `eq.${client.id}`,
        'agentes.pais': `eq.${country}`,
        order: 'created_at.desc,id.desc',
        limit: String(pageSize),
        offset: String(offset),
      });
      const { body: page } = await supabaseRestRequest(
        `bitacora_gestiones?${params.toString()}`,
        {},
        context,
      );
      if (!Array.isArray(page)) throw new Error('CLIENT_HISTORY_RESPONSE_INVALID');

      for (const row of page) {
        const agent = Array.isArray(row.agentes) ? row.agentes[0] : row.agentes;
        const timestamp = String(row.created_at || '');
        const dynamicValues = row.valores_dinamicos && typeof row.valores_dinamicos === 'object'
          ? row.valores_dinamicos as Record<string, unknown>
          : {};
        const pbxCall = dynamicValues.pbxCall && typeof dynamicValues.pbxCall === 'object'
          ? dynamicValues.pbxCall as Record<string, unknown>
          : {};
        const duration = optionalNumber(row.duracion_llamada_segundos)
          ?? optionalNumber(pbxCall.durationSeconds);

        records.push({
          id: String(row.id || ''),
          timestamp,
          date: formatDate(timestamp),
          time: formatTime(timestamp),
          scheduledForDate: String(dynamicValues.scheduledForDate || ''),
          agentId: String(row.agente_id || ''),
          agentName: String(agent?.nombre || 'Agente'),
          agentEmail: String(agent?.email || ''),
          pbxExtension: String(agent?.extension_pbx || ''),
          clientCode: String(client.codigo || clientCode),
          clientName: String(client.nombre || clientCode),
          country,
          channel: String(row.tipo_gestion || ''),
          durationSeconds: duration,
          contactSuccess: String(row.contacto_exitoso || ''),
          agreement: String(row.acuerdo || ''),
          committedAmount: optionalNumber(row.monto_comprometido),
          deadlineDate: row.fecha_limite_pago ? String(row.fecha_limite_pago) : undefined,
          promiseTime: String(dynamicValues.promiseTime || '') || undefined,
          contactName: String(dynamicValues.contactName || '') || undefined,
          contactPhone: String(dynamicValues.contactPhone || '') || undefined,
          contactEmail: String(dynamicValues.contactEmail || '') || undefined,
          observations: String(row.observaciones || ''),
          aiVerdict: row.validacion_exitosa === true
            ? 'Válida'
            : row.validacion_exitosa === false ? 'Inválida' : undefined,
          aiScore: optionalNumber(dynamicValues.aiScore),
          totalDebt: optionalNumber(dynamicValues.totalDebt),
          callRoundLabel: String(dynamicValues.callRoundLabel || ''),
          dynamicValues,
          status: String(dynamicValues.estado || ''),
        });
      }

      if (page.length < pageSize) break;
    }

    return res.status(200).json({
      success: true,
      client: { code: String(client.codigo || clientCode), name: String(client.nombre || clientCode) },
      records,
      truncated: records.length >= maximumRows,
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
