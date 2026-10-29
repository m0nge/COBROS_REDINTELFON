import { timingSafeEqual } from 'node:crypto';
import { supabaseRestRequest } from './supabaseAuth.js';

type Country = 'SV' | 'GT';
type PromiseRecord = {
  id: string;
  cliente_id: string;
  acuerdo: string;
  monto_comprometido: number | string | null;
  created_at: string;
  valores_dinamicos?: Record<string, unknown> | null;
  clientes?: { codigo?: string; pais?: Country } | null;
};
type ClientPeriod = {
  country: Country;
  clientCode: string;
  periods: Map<string, number>;
};

const MAX_ROWS = 1000;
const MAX_PAGES = 20;
const SAN_CONCURRENCY = 24;
const SAN_TIMEOUT_MS = 15000;

function sameSecret(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function getPeriodFromDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return year && month ? `${year}-${month}` : '';
}

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let normalized = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!normalized) return null;
  const comma = normalized.lastIndexOf(',');
  const period = normalized.lastIndexOf('.');
  if (comma >= 0 && period >= 0) {
    normalized = comma > period
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '');
  } else if (comma >= 0) {
    normalized = /\d{3}$/.test(normalized.slice(comma + 1))
      ? normalized.replace(/,/g, '')
      : normalized.replace(',', '.');
  } else if (period >= 0 && /\d{3}$/.test(normalized.slice(period + 1))) {
    normalized = normalized.replace(/\./g, '');
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function isInvoiceFullyPaid(invoice: Record<string, unknown>): boolean {
  const status = String(invoice.estado || '').trim().toLocaleUpperCase('es-SV');
  if (status === 'PAGADO' || status === 'PAID') return true;
  if (status.includes('PARCIAL')) {
    const total = parseAmount(invoice.valordoc);
    const paid = parseAmount(invoice.pago);
    return total !== null && paid !== null && total - paid <= 0.01;
  }
  return false;
}

async function getInvoices(country: Country, clientCode: string): Promise<Record<string, unknown>[] | null> {
  const url = new URL('https://san.red.com.sv/consultaIntegral/tablaFacturaR.html');
  url.searchParams.set('cliente', clientCode);
  url.searchParams.set('pais', country);
  url.searchParams.set('uniqid', Date.now().toString());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SAN_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return Array.isArray(payload) ? payload as Record<string, unknown>[] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifySanClientPaid(country: Country, clientCode: string): Promise<boolean> {
  const invoices = await getInvoices(country, clientCode);
  return Boolean(invoices?.length && invoices.every(isInvoiceFullyPaid));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function getAllRows(pathWithoutRange: string): Promise<any[]> {
  const rows: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * MAX_ROWS;
    const separator = pathWithoutRange.includes('?') ? '&' : '?';
    const { body } = await supabaseRestRequest(
      `${pathWithoutRange}${separator}limit=${MAX_ROWS}&offset=${offset}`,
    );
    if (!Array.isArray(body)) throw new Error('SUPABASE_RESPONSE_INVALID');
    rows.push(...body);
    if (body.length < MAX_ROWS) return rows;
  }
  throw new Error('SUPABASE_RESULT_TOO_LARGE');
}

function groupPromises(rows: PromiseRecord[]): ClientPeriod[] {
  const groups = new Map<string, ClientPeriod>();
  rows.forEach((row) => {
    const clientCode = String(row.clientes?.codigo || '').trim();
    const country = row.clientes?.pais;
    if (!clientCode || (country !== 'SV' && country !== 'GT')) return;

    const explicitMonth = String(row.valores_dinamicos?.periodMonth || '');
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(explicitMonth)
      ? explicitMonth
      : getPeriodFromDate(row.created_at);
    if (!month) return;

    const key = `${country}:${clientCode}`;
    const group = groups.get(key) || { country, clientCode, periods: new Map<string, number>() };
    const amount = parseAmount(row.monto_comprometido) || 0;
    group.periods.set(month, (group.periods.get(month) || 0) + amount);
    groups.set(key, group);
  });
  return Array.from(groups.values());
}

export async function runPaymentReconciliation(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const expectedSecret = process.env.CRON_SECRET || '';
  const authorization = String(req.headers?.authorization || req.headers?.Authorization || '');
  const suppliedSecret = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!expectedSecret) {
    return res.status(503).json({ success: false, error: 'CRON_SECRET_NOT_CONFIGURED' });
  }
  if (!suppliedSecret || !sameSecret(suppliedSecret, expectedSecret)) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }

  try {
    const agreementsQuery = new URLSearchParams({
      select: 'id,cliente_id,acuerdo,monto_comprometido,created_at,valores_dinamicos,clientes!inner(codigo,pais)',
      contacto_exitoso: 'eq.Si',
      validacion_exitosa: 'eq.true',
      acuerdo: 'in.("Promesa de Pago","Negociación de Cuotas")',
      fecha_limite_pago: 'not.is.null',
      order: 'created_at.desc,id.desc',
    });
    const agreementRows = await getAllRows(`bitacora_gestiones?${agreementsQuery.toString()}`);

    const resolvedQuery = new URLSearchParams({
      select: 'pais,codigo_cliente,mes_periodo',
      estado: 'eq.Resuelto',
    });
    const resolvedRows = await getAllRows(`estado_cartera_mensual?${resolvedQuery.toString()}`);
    const alreadyResolved = new Set(
      resolvedRows.map((row) => `${row.pais}:${row.codigo_cliente}:${row.mes_periodo}`),
    );
    const groups = groupPromises(agreementRows as PromiseRecord[]);

    let checked = 0;
    let unavailable = 0;
    let notFullyPaid = 0;
    let reopened = 0;
    const stateRows: Array<Record<string, unknown>> = [];
    let recovered = 0;

    await mapWithConcurrency(groups, SAN_CONCURRENCY, async (group) => {
      const invoices = await getInvoices(group.country, group.clientCode);
      checked += 1;
      if (!invoices || invoices.length === 0) {
        unavailable += 1;
        return;
      }
      if (!invoices.every(isInvoiceFullyPaid)) {
        notFullyPaid += 1;
        const verifiedAt = new Date().toISOString();
        group.periods.forEach((_, month) => {
          const key = `${group.country}:${group.clientCode}:${month}`;
          if (!alreadyResolved.has(key)) return;
          stateRows.push({
            pais: group.country,
            codigo_cliente: group.clientCode,
            mes_periodo: month,
            estado: 'Pendiente',
            monto_recuperado: 0,
            verificado_en: verifiedAt,
            updated_at: verifiedAt,
          });
          reopened += 1;
        });
        return;
      }

      const verifiedAt = new Date().toISOString();
      group.periods.forEach((promisedAmount, month) => {
        const key = `${group.country}:${group.clientCode}:${month}`;
        if (alreadyResolved.has(key)) return;
        stateRows.push({
          pais: group.country,
          codigo_cliente: group.clientCode,
          mes_periodo: month,
          estado: 'Resuelto',
          monto_recuperado: Number(promisedAmount.toFixed(2)),
          verificado_en: verifiedAt,
          updated_at: verifiedAt,
        });
        recovered += 1;
      });
    });

    for (let index = 0; index < stateRows.length; index += 100) {
      const batch = stateRows.slice(index, index + 100);
      await supabaseRestRequest(
        'estado_cartera_mensual?on_conflict=pais,codigo_cliente,mes_periodo',
        {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(batch),
        },
      );
    }

    return res.status(200).json({
      success: true,
      checked,
      recovered,
      reopened,
      notFullyPaid,
      unavailable,
      ranAt: new Date().toISOString(),
    });
  } catch {
    return res.status(502).json({ success: false, error: 'PAYMENT_RECONCILIATION_FAILED' });
  }
}
