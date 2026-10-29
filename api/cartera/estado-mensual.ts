import {
  authenticateAgentRequest,
  respondAuthError,
  supabaseRestRequest,
} from '../../server/supabaseAuth.js';
import { verifySanClientPaid } from '../../server/paymentReconciliation.js';

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

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  const method = String(req.method || '').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { agent } = await authenticateAgentRequest(req);
    const body = method === 'POST' ? parseBody(req.body) : {};
    if (method === 'POST' && !body) {
      return res.status(400).json({ success: false, error: 'INVALID_JSON' });
    }
    const requestedCountry = queryValue(method === 'POST' ? body?.pais : req.query?.pais).toUpperCase();
    const country = (requestedCountry || agent.pais) as 'SV' | 'GT';
    const month = queryValue(method === 'POST' ? body?.mes : req.query?.mes);

    if (country !== 'SV' && country !== 'GT') {
      return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
    }
    if (agent.rol !== 'admin' && country !== agent.pais) {
      return res.status(403).json({ success: false, error: 'COUNTRY_ACCESS_DENIED' });
    }
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ success: false, error: 'INVALID_MONTH' });
    }

    if (method === 'POST') {
      const clientCode = queryValue(body?.codigo_cliente).trim();
      if (!clientCode || !month) {
        return res.status(400).json({ success: false, error: 'CLIENT_AND_MONTH_REQUIRED' });
      }

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

    const states: Array<Record<string, unknown>> = [];
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
      if (!Array.isArray(page)) {
        throw new Error('INVALID_MONTHLY_STATE_RESPONSE');
      }
      states.push(...page);
      if (page.length < 1000) break;
    }
    return res.status(200).json({ success: true, states });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
