import {
  ApiAuthError,
  assertAgentClientAccess,
  assertAgentCountryAccess,
  authenticateAgentRequest,
  getAssignedClientCodes,
  respondAuthError,
  supabaseRestRequest,
} from '../supabaseAuth.js';
import { verifySanClientPaid } from '../paymentReconciliation.js';

function queryValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function parseBody(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function elSalvadorDateKey(value: unknown): string {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function loadManagedSummaries(
  country: 'SV' | 'GT',
  month: string,
  assignedCodes: Set<string>,
): Promise<Array<Record<string, unknown>>> {
  if (!month || assignedCodes.size === 0) return [];
  const codes = [...assignedCodes];
  const clientRows: Array<{ id: string; codigo: string }> = [];
  for (let index = 0; index < codes.length; index += 100) {
    const params = new URLSearchParams({
      select: 'id,codigo',
      pais: `eq.${country}`,
      codigo: `in.(${codes.slice(index, index + 100).join(',')})`,
      limit: '1000',
    });
    const { body } = await supabaseRestRequest(`clientes?${params.toString()}`);
    if (!Array.isArray(body)) throw new Error('MANAGED_CLIENT_LOOKUP_FAILED');
    clientRows.push(...body);
  }

  const codeById = new Map(clientRows.map((row) => [String(row.id), String(row.codigo).trim().toUpperCase()]));
  const clientIds = [...codeById.keys()];
  if (clientIds.length === 0) return [];
  const summaries: Array<Record<string, unknown>> = [];
  const nextMonth = (() => {
    const [year, monthNumber] = month.split('-').map(Number);
    const nextYear = monthNumber === 12 ? year + 1 : year;
    const nextNumber = monthNumber === 12 ? 1 : monthNumber + 1;
    return `${nextYear}-${String(nextNumber).padStart(2, '0')}-01`;
  })();
  const monthStartUtc = new Date(`${month}-01T00:00:00-06:00`).toISOString();
  const nextMonthStartUtc = new Date(`${nextMonth}T00:00:00-06:00`).toISOString();

  for (let index = 0; index < clientIds.length; index += 100) {
    const ids = clientIds.slice(index, index + 100);
    for (let offset = 0; ; offset += 1000) {
      const params = new URLSearchParams({
        select: 'id,cliente_id,agente_id,acuerdo,contacto_exitoso,validacion_exitosa,fecha_limite_pago,created_at,valores_dinamicos',
        cliente_id: `in.(${ids.join(',')})`,
        validacion_exitosa: 'eq.true',
        order: 'created_at.desc,id.desc',
        limit: '1000',
        offset: String(offset),
      });
      params.set(
        'or',
        `(valores_dinamicos->>periodMonth.eq.${month},and(valores_dinamicos->>scheduledForDate.gte.${month}-01,valores_dinamicos->>scheduledForDate.lt.${nextMonth}),and(created_at.gte.${monthStartUtc},created_at.lt.${nextMonthStartUtc}))`,
      );

      const { body } = await supabaseRestRequest(`bitacora_gestiones?${params.toString()}`);
      if (!Array.isArray(body)) throw new Error('MANAGED_RECORD_LOOKUP_FAILED');
      for (const row of body) {
        const values = row.valores_dinamicos && typeof row.valores_dinamicos === 'object'
          ? row.valores_dinamicos as Record<string, unknown>
          : {};
        const agreement = String(row.acuerdo || '');
        const status = String(values.estado || '');
        const isPayment = values.paymentOutcome === 'payment_received'
          && Boolean(values.paymentDate && values.paymentEvidencePath);
        const isPromise = (agreement === 'Promesa de Pago' || agreement === 'Negociación de Cuotas')
          && Boolean(row.fecha_limite_pago);

        const clientCode = codeById.get(String(row.cliente_id || ''));
        if (!clientCode) continue;
        // Older saved records may have scheduledForDate but no periodMonth.
        // Use the scheduled date as the authoritative operational month, then
        // fall back to periodMonth and finally the real creation date.
        const scheduledForDate = String(values.scheduledForDate || '').slice(0, 10);
        const recordMonth = scheduledForDate.slice(0, 7)
          || String(values.periodMonth || '').slice(0, 7)
          || elSalvadorDateKey(row.created_at).slice(0, 7);
        if (recordMonth !== month) continue;
        summaries.push({
          id: String(row.id || ''),
          clientCode,
          country,
          agreement,
          outcome: isPayment ? 'payment_received' : isPromise ? 'promise' : 'contact',
          status: status || (isPayment ? 'Resuelto' : 'Contactado'),
          scheduledForDate: scheduledForDate || elSalvadorDateKey(row.created_at),
          createdAt: String(row.created_at || ''),
          agentId: String(row.agente_id || ''),
        });
      }
      if (body.length < 1000) break;
    }
  }

  return summaries;
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
    if (method === 'POST' && !body) {
      return res.status(400).json({ success: false, error: 'INVALID_JSON' });
    }
    const requestedCountry = queryValue(method === 'POST' ? body?.pais : req.query?.pais).toUpperCase();
    const country = (requestedCountry || context.agent.pais) as 'SV' | 'GT';
    const month = queryValue(method === 'POST' ? body?.mes : req.query?.mes);

    if (country !== 'SV' && country !== 'GT') {
      return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
    }
    assertAgentCountryAccess(context, country);
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ success: false, error: 'INVALID_MONTH' });
    }

    if (method === 'POST') {
      const clientCode = queryValue(body?.codigo_cliente).trim();
      if (!clientCode || !month) {
        return res.status(400).json({ success: false, error: 'CLIENT_AND_MONTH_REQUIRED' });
      }
      await assertAgentClientAccess(context, country, clientCode);

      const { body: clientRows } = await supabaseRestRequest(
        `clientes?select=id&codigo=eq.${encodeURIComponent(clientCode)}&pais=eq.${country}&limit=1`,
      );
      if (!Array.isArray(clientRows) || clientRows.length === 0) {
        return res.status(404).json({ success: false, error: 'CLIENT_NOT_FOUND' });
      }
      if (!(await verifySanClientPaid(country, clientCode))) {
        return res.status(409).json({ success: false, error: 'CLIENT_HAS_UNPAID_OR_UNVERIFIED_INVOICES' });
      }

      const verifiedAt = new Date().toISOString();
      await supabaseRestRequest(
        'estado_cartera_mensual?on_conflict=pais,codigo_cliente,mes_periodo',
        {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            pais: country,
            codigo_cliente: clientCode,
            mes_periodo: month,
            estado: 'Resuelto',
            verificado_en: verifiedAt,
            updated_at: verifiedAt,
          }),
        },
      );
      return res.status(200).json({
        success: true,
        recovered: true,
        pais: country,
        codigo_cliente: clientCode,
        mes: month,
      });
    }

    const syncWarnings: string[] = [];
    const states: Array<Record<string, unknown>> = [];
    let managed: Array<Record<string, unknown>> = [];
    let assignedCodesForStates: Set<string> | undefined;
    if (context.agent.rol !== 'admin') {
      try {
        const assignedCodes = await getAssignedClientCodes(context);
        assignedCodesForStates = assignedCodes;
        if (assignedCodes.size === 0) syncWarnings.push('MANAGED:NO_ASSIGNED_CLIENTS');
        managed = await loadManagedSummaries(country, month, assignedCodes);
      } catch (error) {
        syncWarnings.push(
          `MANAGED:${error instanceof ApiAuthError ? error.code : 'SYNC_FAILED'}`,
        );
      }
    }

    try {
      for (let offset = 0; ; offset += 1000) {
        const params = new URLSearchParams({
          select: 'pais,codigo_cliente,mes_periodo,estado,monto_recuperado,verificado_en',
          pais: `eq.${country}`,
          estado: 'eq.Resuelto',
          order: 'mes_periodo.desc',
          limit: '1000',
          offset: String(offset),
        });
        if (month) params.set('mes_periodo', `eq.${month}`);
        const { body: page } = await supabaseRestRequest(`estado_cartera_mensual?${params.toString()}`);
        if (!Array.isArray(page)) throw new Error('INVALID_MONTHLY_STATE_RESPONSE');
        states.push(...page);
        if (page.length < 1000) break;
      }
    } catch (error) {
      syncWarnings.push(
        `MONTHLY_STATE:${error instanceof ApiAuthError ? error.code : 'UNAVAILABLE'}`,
      );
    }

    const visibleStates = assignedCodesForStates
      ? states.filter((state) => assignedCodesForStates.has(String(state.codigo_cliente || '').trim().toUpperCase()))
      : context.agent.rol === 'admin' ? states : [];
    return res.status(200).json({
      success: true,
      states: visibleStates,
      managed,
      syncWarnings: [...new Set(syncWarnings)],
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
