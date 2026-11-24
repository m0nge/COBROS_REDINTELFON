import {
  authenticateAgentRequest,
  assertAgentCountryAccess,
  getAssignedClientCodes,
  respondAuthError,
  supabaseRestRequest,
} from '../supabaseAuth.js';

type Country = 'SV' | 'GT';

function currentElSalvadorMonthKey(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return year && month ? `${year}-${month}` : '';
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function loadVisibleClients(
  country: Country,
  assignedCodes: Set<string>,
  isAdmin: boolean,
  context: any,
): Promise<Array<{ id: string; code: string }>> {
  const rows: Array<{ id: string; codigo: string }> = [];
  if (isAdmin) {
    for (let offset = 0; ; offset += 1000) {
      const params = new URLSearchParams({
        select: 'id,codigo',
        pais: `eq.${country}`,
        order: 'codigo.asc',
        limit: '1000',
        offset: String(offset),
      });
      const { body } = await supabaseRestRequest(`clientes?${params.toString()}`, {}, context);
      if (!Array.isArray(body)) throw new Error('CLIENT_LOOKUP_FAILED');
      rows.push(...body);
      if (body.length < 1000) break;
    }
  } else {
    const codes = [...assignedCodes];
    for (const codeBatch of chunks(codes, 100)) {
      const params = new URLSearchParams({
        select: 'id,codigo',
        pais: `eq.${country}`,
        codigo: `in.(${codeBatch.join(',')})`,
        order: 'codigo.asc',
        limit: '1000',
      });
      const { body } = await supabaseRestRequest(`clientes?${params.toString()}`, {}, context);
      if (!Array.isArray(body)) throw new Error('CLIENT_LOOKUP_FAILED');
      rows.push(...body);
    }
  }

  return rows.flatMap((row) => {
    const id = String(row.id || '');
    const code = String(row.codigo || '').trim().toUpperCase();
    return id && code ? [{ id, code }] : [];
  });
}

async function loadContactedCodes(
  clients: Array<{ id: string; code: string }>,
  month: string,
  context: any,
): Promise<Set<string>> {
  const codeByClientId = new Map(clients.map((client) => [client.id, client.code]));
  const contactedCodes = new Set<string>();
  const clientIds = [...codeByClientId.keys()];
  const [year, monthNumber] = month.split('-').map(Number);
  // Local midnight in El Salvador is 06:00 UTC (UTC−6).
  const monthStart = new Date(Date.UTC(year, monthNumber - 1, 1, 6)).toISOString();
  const nextMonthStart = new Date(Date.UTC(year, monthNumber, 1, 6)).toISOString();

  for (const idBatch of chunks(clientIds, 100)) {
    for (let offset = 0; ; offset += 1000) {
      const params = new URLSearchParams({
        select: 'cliente_id',
        cliente_id: `in.(${idBatch.join(',')})`,
        order: 'cliente_id.asc',
        limit: '1000',
        offset: String(offset),
      });
      params.append('created_at', `gte.${monthStart}`);
      params.append('created_at', `lt.${nextMonthStart}`);
      const { body } = await supabaseRestRequest(
        `bitacora_gestiones?${params.toString()}`,
        {},
        context,
      );
      if (!Array.isArray(body)) throw new Error('CONTACT_HISTORY_LOOKUP_FAILED');
      body.forEach((row) => {
        const code = codeByClientId.get(String(row.cliente_id || ''));
        if (code) contactedCodes.add(code);
      });
      if (body.length < 1000) break;
    }
  }

  return contactedCodes;
}

async function loadResolvedCodes(
  country: Country,
  clients: Array<{ id: string; code: string }>,
  isAdmin: boolean,
  month: string,
  context: any,
): Promise<Set<string>> {
  const clientCodes = [...new Set(clients.map((client) => client.code))];
  const resolvedCodes = new Set<string>();
  const codeScopes: Array<string[] | null> = isAdmin
    ? [null]
    : chunks(clientCodes, 100);

  for (const codeScope of codeScopes) {
    for (let offset = 0; ; offset += 1000) {
      const params = new URLSearchParams({
        select: 'codigo_cliente',
        pais: `eq.${country}`,
        mes_periodo: `eq.${month}`,
        estado: 'eq.Resuelto',
        order: 'codigo_cliente.asc',
        limit: '1000',
        offset: String(offset),
      });
      if (codeScope) params.set('codigo_cliente', `in.(${codeScope.join(',')})`);
      const { body } = await supabaseRestRequest(
        `estado_cartera_mensual?${params.toString()}`,
        {},
        context,
      );
      if (!Array.isArray(body)) throw new Error('MONTHLY_STATE_LOOKUP_FAILED');
      body.forEach((row) => {
        const code = String(row.codigo_cliente || '').trim().toUpperCase();
        if (code) resolvedCodes.add(code);
      });
      if (body.length < 1000) break;
    }
  }

  return resolvedCodes;
}

export default async function noContactadosHandler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const context = await authenticateAgentRequest(req);
    const country = String(req.query?.pais || context.agent.pais).toUpperCase() as Country;
    if (country !== 'SV' && country !== 'GT') {
      return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
    }
    assertAgentCountryAccess(context, country);

    const assignedCodes = await getAssignedClientCodes(context);
    const isAdmin = context.agent.rol === 'admin';
    const month = currentElSalvadorMonthKey();
    const clients = await loadVisibleClients(country, assignedCodes, isAdmin, context);
    const [contactedCodes, resolvedCodes] = await Promise.all([
      loadContactedCodes(clients, month, context),
      loadResolvedCodes(country, clients, isAdmin, month, context),
    ]);

    return res.status(200).json({
      success: true,
      pais: country,
      mes: month,
      contactedClientCodes: [...contactedCodes].sort(),
      resolvedClientCodes: [...resolvedCodes].sort(),
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      return respondAuthError(res, error);
    }
    return res.status(502).json({
      success: false,
      error: 'CONTACT_STATUS_UNAVAILABLE',
      message: 'No se pudo verificar el historial de contactos en la bitácora.',
    });
  }
}
