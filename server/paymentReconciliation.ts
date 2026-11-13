import { timingSafeEqual } from 'node:crypto';
import { supabaseRestRequest } from './supabaseAuth.js';
import { reconcilePbxTranscriptions } from './routes/pbxTranscriptionsCron.js';

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
export type SanMonthPaymentCheck = {
  status: 'paid' | 'unpaid' | 'unknown';
  amount: number;
};

const MAX_ROWS = 1000;
const MAX_PAGES = 20;
const SAN_CONCURRENCY = 24;
const SAN_TIMEOUT_MS = 15000;
const PORTFOLIO_SCAN_BATCH_SIZE = 24;

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

export function getPromiseReconciliationMonth(
  row: Pick<PromiseRecord, 'created_at' | 'valores_dinamicos'>,
): string {
  const values = row.valores_dinamicos || {};
  const scheduledForDate = String(values.scheduledForDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(scheduledForDate)) return scheduledForDate.slice(0, 7);
  const explicitMonth = String(values.periodMonth || '');
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(explicitMonth)) return explicitMonth;
  return getPeriodFromDate(row.created_at);
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

function isBalanceCleared(total: number, paid: number): boolean {
  return Math.round(Math.max(0, total - paid) * 100) <= 1;
}

function normalizeInvoiceStatus(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleUpperCase('es-SV')
    .replace(/\s+/g, ' ');
}

function isVoidedInvoiceStatus(status: string): boolean {
  return ['ANULADO', 'ANULADA', 'CANCELADO', 'CANCELADA'].includes(status);
}

function isInvoiceFullyPaid(invoice: Record<string, unknown>): boolean {
  const status = normalizeInvoiceStatus(invoice.estado);
  if (status === 'PAGADO' || status === 'PAGADA' || status === 'PAID') return true;
  if (status.includes('PARCIAL')) {
    const total = parseAmount(invoice.valordoc);
    const paid = parseAmount(invoice.pago);
    return total !== null && paid !== null && isBalanceCleared(total, paid);
  }
  return false;
}

function getSanDateKey(value: unknown): string {
  const dateKey = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : '';
}

function getSanInvoiceIssueDate(invoice: Record<string, unknown>): string {
  return getSanDateKey(
    invoice.fechaEmision
    || invoice.fechaemision
    || invoice.fecha_emision
    || invoice.fecha_emision_factura,
  );
}

function shiftMonthKey(month: string, offset: number): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return '';
  const [year, monthNumber] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function getPreviousInvoiceMonth(month: string): string {
  return shiftMonthKey(month, -1);
}

export function getSanInvoiceMonthsBeforeMonth(
  invoices: Record<string, unknown>[],
  month: string,
): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const invoiceMonths = new Set<string>();
  for (const invoice of invoices) {
    const status = normalizeInvoiceStatus(invoice.estado);
    if (isVoidedInvoiceStatus(status)) continue;
    const issueDate = getSanInvoiceIssueDate(invoice);
    if (!issueDate) continue;
    const invoiceMonth = issueDate.slice(0, 7);
    if (invoiceMonth < month) invoiceMonths.add(invoiceMonth);
  }
  return [...invoiceMonths].sort();
}

export function hasUnpaidSanInvoiceIssuedInMonth(
  invoices: Record<string, unknown>[],
  month: string,
): boolean | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  let incomplete = false;
  let hasOutstandingInvoice = false;
  for (const invoice of invoices) {
    const status = normalizeInvoiceStatus(invoice.estado);
    const issueDate = getSanInvoiceIssueDate(invoice);
    if (isVoidedInvoiceStatus(status)) continue;
    if (!issueDate || !status) {
      incomplete = true;
      continue;
    }
    if (issueDate.slice(0, 7) !== month) continue;

    if (['PAGADO', 'PAGADA', 'PAID'].includes(status)) continue;
    if (status.includes('PARCIAL')) {
      const total = parseAmount(invoice.valordoc);
      const paid = parseAmount(invoice.pago);
      if (total === null || paid === null) {
        incomplete = true;
        continue;
      }
      if (!isBalanceCleared(total, paid)) hasOutstandingInvoice = true;
      continue;
    }
    if (status.startsWith('PENDIENTE') || ['POR PAGAR', 'NO PAGADO', 'UNPAID', 'OPEN'].includes(status)) {
      const total = parseAmount(invoice.valordoc);
      if (total === null) {
        incomplete = true;
        continue;
      }
      if (total > 0.01) hasOutstandingInvoice = true;
      continue;
    }
    incomplete = true;
  }
  if (hasOutstandingInvoice) return true;
  return incomplete ? null : false;
}

function getElSalvadorDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : '';
}

function getMoraRange(daysArrears: number): string {
  if (daysArrears <= 30) return '0-30';
  if (daysArrears <= 60) return '31-60';
  if (daysArrears <= 90) return '61-90';
  if (daysArrears <= 120) return '91-120';
  return '120+';
}

export type SanPortfolioSnapshot = {
  totalDebt: number;
  daysArrears: number;
  moraRange: string;
};

/**
 * Builds the same outstanding-balance and maximum-overdue-day values shown by
 * Cliente 360 from SAN's invoice rows. Unknown invoice fields make the snapshot
 * unavailable instead of silently treating the client as debt-free.
 */
export function summarizeSanPortfolioInvoices(
  invoices: Record<string, unknown>[],
  asOfDate = getElSalvadorDateKey(),
): SanPortfolioSnapshot | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return null;
  const asOfDay = Date.parse(`${asOfDate}T00:00:00Z`);
  if (!Number.isFinite(asOfDay)) return null;

  let totalDebt = 0;
  let daysArrears = 0;
  for (const invoice of invoices) {
    const status = normalizeInvoiceStatus(invoice.estado);
    if (isVoidedInvoiceStatus(status)) continue;
    const total = parseAmount(invoice.valordoc);
    if (total === null) return null;

    let outstanding = 0;
    if (['PAGADO', 'PAGADA', 'PAID'].includes(status)) {
      outstanding = 0;
    } else if (status.includes('PARCIAL')) {
      const paid = parseAmount(invoice.pago);
      if (paid === null) return null;
      outstanding = Math.max(0, total - paid);
    } else if (
      status.startsWith('PENDIENTE')
      || ['POR PAGAR', 'NO PAGADO', 'UNPAID', 'OPEN'].includes(status)
    ) {
      outstanding = Math.max(0, total);
    } else {
      return null;
    }

    if (outstanding <= 0.01) continue;
    totalDebt += outstanding;
    const dueDate = getSanDateKey(
      invoice.fechavence
      || invoice.fechaVence
      || invoice.fecha_vencimiento
      || invoice.fechaVencimiento,
    );
    if (!dueDate) return null;
    const dueDay = Date.parse(`${dueDate}T00:00:00Z`);
    if (!Number.isFinite(dueDay)) return null;
    daysArrears = Math.max(daysArrears, Math.min(365, Math.max(0, Math.floor((asOfDay - dueDay) / 86400000))));
  }

  const safeDebt = Number(totalDebt.toFixed(2));
  return {
    totalDebt: safeDebt,
    daysArrears,
    moraRange: getMoraRange(daysArrears),
  };
}

export function verifySanInvoicesForMonth(
  invoices: Record<string, unknown>[],
  month: string,
): SanMonthPaymentCheck {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return { status: 'unknown', amount: 0 };
  }
  if (invoices.some((invoice) => !getSanInvoiceIssueDate(invoice))) {
    return { status: 'unknown', amount: 0 };
  }

  const monthInvoices = invoices.filter((invoice) => {
    const issueDate = getSanInvoiceIssueDate(invoice);
    return issueDate.slice(0, 7) === month;
  });

  let amount = 0;
  for (const invoice of monthInvoices) {
    const status = normalizeInvoiceStatus(invoice.estado);
    if (isVoidedInvoiceStatus(status)) continue;

    const total = parseAmount(invoice.valordoc);
    if (status === 'PAGADO' || status === 'PAGADA' || status === 'PAID') {
      if (total === null) return { status: 'unknown', amount: 0 };
      amount += total;
      continue;
    }
    if (status.includes('PARCIAL')) {
      const paid = parseAmount(invoice.pago);
      if (total === null || paid === null) return { status: 'unknown', amount: 0 };
      if (isBalanceCleared(total, paid)) {
        amount += total;
        continue;
      }
      return { status: 'unpaid', amount: 0 };
    }
    if (status.startsWith('PENDIENTE') || ['POR PAGAR', 'NO PAGADO', 'UNPAID', 'OPEN'].includes(status)) {
      const total = parseAmount(invoice.valordoc);
      if (total === null) return { status: 'unknown', amount: 0 };
      if (total > 0.01) return { status: 'unpaid', amount: 0 };
      continue;
    }
    return { status: 'unknown', amount: 0 };
  }

  // SAN's valid empty monthly result means there is no outstanding invoice balance
  // for that month; it is recorded as resolved with $0 recovered.
  return { status: 'paid', amount: Number(amount.toFixed(2)) };
}

async function getInvoices(country: Country, clientCode: string): Promise<Record<string, unknown>[] | null> {
  const url = new URL('https://san.red.com.sv/consultaIntegral/tablaFacturaR.html');
  url.searchParams.set('cliente', clientCode);
  url.searchParams.set('pais', country);
  url.searchParams.set('uniqid', Date.now().toString());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SAN_TIMEOUT_MS);
  try {
    const sanApiKey = String(process.env.SAN_API_KEY || '').trim();
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0',
        ...(sanApiKey ? { 'X-API-KEY': sanApiKey } : {}),
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

export async function verifySanClientMonthPaid(
  country: Country,
  clientCode: string,
  month: string,
): Promise<{ verified: boolean; amount: number }> {
  const invoices = await getInvoices(country, clientCode);
  if (!invoices) return { verified: false, amount: 0 };
  const check = verifySanInvoicesForMonth(invoices, month);
  return { verified: check.status === 'paid', amount: check.status === 'paid' ? check.amount : 0 };
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

export function groupPromises(rows: PromiseRecord[]): ClientPeriod[] {
  const groups = new Map<string, ClientPeriod>();
  const latestByClientPeriod = new Map<string, { createdAt: number; id: string }>();
  rows.forEach((row) => {
    const clientCode = String(row.clientes?.codigo || '').trim();
    const country = row.clientes?.pais;
    if (!clientCode || (country !== 'SV' && country !== 'GT')) return;

    const month = getPromiseReconciliationMonth(row);
    if (!month) return;

    const key = `${country}:${clientCode}`;
    const group = groups.get(key) || { country, clientCode, periods: new Map<string, number>() };
    const periodKey = `${key}:${month}`;
    const createdAt = Date.parse(row.created_at) || 0;
    const latest = latestByClientPeriod.get(periodKey);
    if (
      latest
      && (createdAt < latest.createdAt || (createdAt === latest.createdAt && row.id <= latest.id))
    ) {
      groups.set(key, group);
      return;
    }
    const amount = parseAmount(row.monto_comprometido) || 0;
    group.periods.set(month, amount);
    latestByClientPeriod.set(periodKey, { createdAt, id: row.id });
    groups.set(key, group);
  });
  return Array.from(groups.values());
}

function getCurrentElSalvadorMonth(): string {
  return getElSalvadorDateKey().slice(0, 7);
}

async function getCurrentPortfolioGroups(month: string): Promise<ClientPeriod[]> {
  const params = new URLSearchParams({
    select: 'pais,codigo_cliente',
    order: 'pais.asc,codigo_cliente.asc',
  });
  const assignmentRows = await getAllRows(`asignaciones_cartera_fija?${params.toString()}`);
  const groups = new Map<string, ClientPeriod>();
  for (const row of assignmentRows) {
    const country = String(row.pais || '').trim().toUpperCase() as Country;
    const clientCode = String(row.codigo_cliente || '').trim().toUpperCase();
    if (!clientCode || (country !== 'SV' && country !== 'GT')) continue;
    const key = `${country}:${clientCode}`;
    if (!groups.has(key)) groups.set(key, { country, clientCode, periods: new Map([[month, 0]]) });
  }
  return [...groups.values()];
}

async function loadMonthlyStates(months: string[]) {
  const uniqueMonths = [...new Set(months.filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)))];
  if (uniqueMonths.length === 0) return new Map<string, Record<string, unknown>>();
  const params = new URLSearchParams({
    select: 'pais,codigo_cliente,mes_periodo,estado,monto_recuperado,verificado_en,updated_at,tiene_facturas_mes,facturas_mes_verificado_en',
    mes_periodo: uniqueMonths.length === 1
      ? `eq.${uniqueMonths[0]}`
      : `in.(${uniqueMonths.join(',')})`,
    order: 'updated_at.asc',
  });
  const rows = await getAllRows(`estado_cartera_mensual?${params.toString()}`);
  return new Map(rows.map((row) => [
    `${row.pais}:${String(row.codigo_cliente || '').trim().toUpperCase()}:${row.mes_periodo}`,
    row,
  ]));
}

async function loadPriorInvoiceMonthFlags(groups: ClientPeriod[], beforeMonth: string) {
  const monthsByClient = new Map<string, Set<string>>();
  const codesByCountry = new Map<Country, string[]>();
  for (const group of groups) {
    const codes = codesByCountry.get(group.country) || [];
    codes.push(group.clientCode);
    codesByCountry.set(group.country, codes);
  }

  for (const [country, codes] of codesByCountry) {
    for (let index = 0; index < codes.length; index += 100) {
      const params = new URLSearchParams({
        select: 'pais,codigo_cliente,mes_periodo',
        pais: `eq.${country}`,
        codigo_cliente: `in.(${codes.slice(index, index + 100).join(',')})`,
        mes_periodo: `lt.${beforeMonth}`,
        tiene_facturas_mes: 'eq.true',
        facturas_mes_verificado_en: 'not.is.null',
        order: 'mes_periodo.asc,codigo_cliente.asc',
      });
      const rows = await getAllRows(`estado_cartera_mensual?${params.toString()}`);
      for (const row of rows) {
        const key = `${row.pais}:${String(row.codigo_cliente || '').trim().toUpperCase()}`;
        const months = monthsByClient.get(key) || new Set<string>();
        months.add(String(row.mes_periodo || ''));
        monthsByClient.set(key, months);
      }
    }
  }
  return monthsByClient;
}

async function loadPortfolioClientRows(groups: ClientPeriod[]) {
  const rowsByKey = new Map<string, Record<string, unknown>>();
  const groupedCodes = new Map<Country, string[]>();
  groups.forEach((group) => {
    const codes = groupedCodes.get(group.country) || [];
    codes.push(group.clientCode);
    groupedCodes.set(group.country, codes);
  });
  for (const [country, codes] of groupedCodes) {
    for (let index = 0; index < codes.length; index += 100) {
      const params = new URLSearchParams({
        select: 'codigo,total_deuda,dias_mora,rango_mora',
        pais: `eq.${country}`,
        codigo: `in.(${codes.slice(index, index + 100).join(',')})`,
        limit: '1000',
      });
      const rows = await getAllRows(`clientes?${params.toString()}`);
      rows.forEach((row) => {
        const code = String(row.codigo || '').trim().toUpperCase();
        if (code) rowsByKey.set(`${country}:${code}`, row);
      });
    }
  }
  return rowsByKey;
}

async function scanAssignedPortfolioBalances() {
  const month = getCurrentElSalvadorMonth();
  if (!month) throw new Error('CURRENT_MONTH_UNAVAILABLE');
  const [groups, stateByKey] = await Promise.all([
    getCurrentPortfolioGroups(month),
    loadMonthlyStates([month]),
  ]);
  const [clientRowsByKey, priorInvoiceMonthsByClient] = await Promise.all([
    loadPortfolioClientRows(groups),
    loadPriorInvoiceMonthFlags(groups, month),
  ]);
  groups.sort((left, right) => {
    const leftState = stateByKey.get(`${left.country}:${left.clientCode}:${month}`);
    const rightState = stateByKey.get(`${right.country}:${right.clientCode}:${month}`);
    const leftAttempt = Date.parse(String(leftState?.updated_at || '')) || 0;
    const rightAttempt = Date.parse(String(rightState?.updated_at || '')) || 0;
    return leftAttempt - rightAttempt
      || `${left.country}:${left.clientCode}`.localeCompare(`${right.country}:${right.clientCode}`);
  });

  let checked = 0;
  let resolved = 0;
  let pending = 0;
  let unavailable = 0;
  let moraUpdated = 0;
  for (let index = 0; index < groups.length; index += PORTFOLIO_SCAN_BATCH_SIZE) {
    const batch = groups.slice(index, index + PORTFOLIO_SCAN_BATCH_SIZE);
    const results = await mapWithConcurrency(batch, SAN_CONCURRENCY, async (group) => {
      const invoices = await getInvoices(group.country, group.clientCode);
      const previous = stateByKey.get(`${group.country}:${group.clientCode}:${month}`);
      if (!invoices) {
        return {
          group,
          previous,
          invoices: null,
          currentMonthInvoice: null,
          status: 'unknown' as const,
          amount: Number(previous?.monto_recuperado) || 0,
          snapshot: null,
        };
      }
      const monthCheck = verifySanInvoicesForMonth(invoices, month);
      const snapshot = summarizeSanPortfolioInvoices(invoices);
      return {
        group,
        previous,
        invoices,
        currentMonthInvoice: hasUnpaidSanInvoiceIssuedInMonth(invoices, month),
        status: monthCheck.status,
        amount: monthCheck.amount,
        snapshot,
      };
    });

    const attemptedAt = new Date().toISOString();
    const monthlyRows: Array<Record<string, unknown>> = [];
    const clientUpdates: Array<{ group: ClientPeriod; snapshot: SanPortfolioSnapshot }> = [];
    const snapshotSyncedByKey = new Map<string, boolean>();
    for (const result of results) {
      checked += 1;
      if (result.status === 'unknown' || !result.snapshot) unavailable += 1;
      const resolvedNow = result.status === 'paid';
      const state = result.status === 'unknown'
        ? String(result.previous?.estado || 'Pendiente')
        : resolvedNow ? 'Resuelto' : 'Pendiente';
      if (state === 'Resuelto') resolved += 1;
      else if (result.status === 'unpaid') pending += 1;

      monthlyRows.push({
        pais: result.group.country,
        codigo_cliente: result.group.clientCode,
        mes_periodo: month,
        estado: state,
        monto_recuperado: result.status === 'unknown'
          ? Number(result.previous?.monto_recuperado) || 0
          : result.amount,
        verificado_en: result.status === 'unknown'
          ? result.previous?.verificado_en || null
          : attemptedAt,
        tiene_facturas_mes: result.currentMonthInvoice
          ?? (result.invoices ? null : result.previous?.tiene_facturas_mes)
          ?? null,
        facturas_mes_verificado_en: result.currentMonthInvoice === null
          ? result.invoices
            ? attemptedAt
            : result.previous?.facturas_mes_verificado_en || null
          : attemptedAt,
        updated_at: attemptedAt,
      });

      if (result.snapshot && result.status !== 'unknown') {
        const previousClient = clientRowsByKey.get(`${result.group.country}:${result.group.clientCode}`);
        if (!previousClient) {
          snapshotSyncedByKey.set(`${result.group.country}:${result.group.clientCode}`, false);
        } else {
          // Refresh updated_at alongside SAN's values so cartera can distinguish
          // a new, verified mora snapshot from older database values.
          clientUpdates.push({ group: result.group, snapshot: result.snapshot });
        }
      }
    }

    const invoiceHistoryRows: Array<Record<string, unknown>> = [];
    for (const result of results) {
      if (!result.invoices) continue;
      const clientKey = `${result.group.country}:${result.group.clientCode}`;
      const invoiceMonths = new Set([
        ...(priorInvoiceMonthsByClient.get(clientKey) || []),
        ...getSanInvoiceMonthsBeforeMonth(result.invoices, month),
      ]);
      for (const invoiceMonth of invoiceMonths) {
        const hasUnpaidInvoice = hasUnpaidSanInvoiceIssuedInMonth(result.invoices, invoiceMonth);
        invoiceHistoryRows.push({
          pais: result.group.country,
          codigo_cliente: result.group.clientCode,
          mes_periodo: invoiceMonth,
          tiene_facturas_mes: hasUnpaidInvoice,
          facturas_mes_verificado_en: attemptedAt,
          updated_at: attemptedAt,
        });
      }
    }

    const updateResults = await mapWithConcurrency(clientUpdates, 8, async ({ group, snapshot }) => {
      try {
        await supabaseRestRequest(
          `clientes?pais=eq.${group.country}&codigo=eq.${encodeURIComponent(group.clientCode)}`,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              total_deuda: snapshot.totalDebt,
              dias_mora: snapshot.daysArrears,
              rango_mora: snapshot.moraRange,
              prioridad: snapshot.daysArrears > 90 ? 'Alta' : snapshot.daysArrears > 30 ? 'Media' : 'Normal',
              updated_at: attemptedAt,
            }),
          },
        );
        return { key: `${group.country}:${group.clientCode}`, updated: true };
      } catch {
        return { key: `${group.country}:${group.clientCode}`, updated: false };
      }
    });
    updateResults.forEach((result) => {
      snapshotSyncedByKey.set(result.key, result.updated);
      if (result.updated) moraUpdated += 1;
    });

    results.forEach((result, resultIndex) => {
      const key = `${result.group.country}:${result.group.clientCode}`;
      if (result.status === 'unknown') {
        monthlyRows[resultIndex].verificado_en = result.previous?.verificado_en || null;
      } else if (!result.snapshot || snapshotSyncedByKey.get(key)) {
        monthlyRows[resultIndex].verificado_en = attemptedAt;
      } else {
        monthlyRows[resultIndex].verificado_en = result.previous?.verificado_en || null;
      }
    });
    for (let rowIndex = 0; rowIndex < monthlyRows.length; rowIndex += 100) {
      await supabaseRestRequest(
        'estado_cartera_mensual?on_conflict=pais,codigo_cliente,mes_periodo',
        {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(monthlyRows.slice(rowIndex, rowIndex + 100)),
        },
      );
    }
    for (let rowIndex = 0; rowIndex < invoiceHistoryRows.length; rowIndex += 100) {
      await supabaseRestRequest(
        'estado_cartera_mensual?on_conflict=pais,codigo_cliente,mes_periodo',
        {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(invoiceHistoryRows.slice(rowIndex, rowIndex + 100)),
        },
      );
    }

    batch.forEach((group, offset) => {
      const result = results[offset];
      stateByKey.set(`${group.country}:${group.clientCode}:${month}`, {
        pais: group.country,
        codigo_cliente: group.clientCode,
        mes_periodo: month,
        estado: result.status === 'unknown'
          ? String(result.previous?.estado || 'Pendiente')
          : result.status === 'paid' ? 'Resuelto' : 'Pendiente',
        monto_recuperado: result.status === 'unknown'
          ? Number(result.previous?.monto_recuperado) || 0
          : result.amount,
        verificado_en: result.status === 'unknown'
          ? result.previous?.verificado_en || null
          : attemptedAt,
        tiene_facturas_mes: result.currentMonthInvoice
          ?? (result.invoices ? null : result.previous?.tiene_facturas_mes)
          ?? null,
        facturas_mes_verificado_en: result.currentMonthInvoice === null
          ? result.invoices
            ? attemptedAt
            : result.previous?.facturas_mes_verificado_en || null
          : attemptedAt,
        updated_at: attemptedAt,
      });
    });
  }
  return { month, assignedClients: groups.length, checked, resolved, pending, unavailable, moraUpdated };
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
    const requestPath = [
      Array.isArray(req.query?.path) ? req.query.path.join('/') : String(req.query?.path || ''),
      String(req.url || '').split('?')[0],
    ].join(' ');
    const isMidnightRun = requestPath.includes('reconciliar-pagos-medianoche');
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
      if (!invoices) {
        unavailable += 1;
        return;
      }

      for (const month of group.periods.keys()) {
        const key = `${group.country}:${group.clientCode}:${month}`;
        const monthCheck = verifySanInvoicesForMonth(invoices, month);
        if (monthCheck.status === 'unknown') {
          unavailable += 1;
          continue;
        }
        const verifiedAt = new Date().toISOString();
        if (monthCheck.status === 'unpaid') {
          notFullyPaid += 1;
          if (!alreadyResolved.has(key)) continue;
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
          continue;
        }

        stateRows.push({
          pais: group.country,
          codigo_cliente: group.clientCode,
          mes_periodo: month,
          estado: 'Resuelto',
          monto_recuperado: monthCheck.amount,
          verificado_en: verifiedAt,
          updated_at: verifiedAt,
        });
        if (!alreadyResolved.has(key)) recovered += 1;
      }
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

    let pbxTranscriptions: Record<string, unknown> | null = null;
    if (isMidnightRun) {
      try {
        pbxTranscriptions = await reconcilePbxTranscriptions();
      } catch {
        pbxTranscriptions = { success: false, error: 'PBX_TRANSCRIPT_RECONCILIATION_FAILED' };
      }
    }

    let portfolioScan: Record<string, unknown> | null = null;
    if (isMidnightRun) {
      try {
        portfolioScan = { success: true, ...(await scanAssignedPortfolioBalances()) };
      } catch {
        portfolioScan = { success: false, error: 'PORTFOLIO_SCAN_FAILED' };
      }
    }

    return res.status(200).json({
      success: true,
      checked,
      recovered,
      reopened,
      notFullyPaid,
      unavailable,
      ...(portfolioScan ? { portfolioScan } : {}),
      ...(pbxTranscriptions ? { pbxTranscriptions } : {}),
      ranAt: new Date().toISOString(),
    });
  } catch {
    return res.status(502).json({ success: false, error: 'PAYMENT_RECONCILIATION_FAILED' });
  }
}
