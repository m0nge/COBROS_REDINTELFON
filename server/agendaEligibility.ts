export interface ClientMoraRow {
  codigo?: unknown;
  dias_mora?: unknown;
  updated_at?: unknown;
}

export interface AgendaRefreshStateRow {
  codigo_cliente?: unknown;
  updated_at?: unknown;
  facturas_mes_verificado_en?: unknown;
}

export interface AgendaRefreshClientRow {
  codigo?: unknown;
  updated_at?: unknown;
}

export function getAgendaRefreshPlan(
  assignedCodes: Iterable<string>,
  monthlyRows: Iterable<AgendaRefreshStateRow>,
  clientRows: Iterable<AgendaRefreshClientRow>,
  verifiedAfter: string,
  retryAfter: string,
): { codesToRefresh: string[]; recentlyAttemptedCodes: string[] } {
  const verifiedAfterMs = Date.parse(verifiedAfter);
  const retryAfterMs = Date.parse(retryAfter);
  if (!Number.isFinite(verifiedAfterMs) || !Number.isFinite(retryAfterMs)) {
    return { codesToRefresh: [], recentlyAttemptedCodes: [] };
  }

  const monthlyByCode = new Map<string, AgendaRefreshStateRow>();
  for (const row of monthlyRows) {
    const code = String(row.codigo_cliente || '').trim().toUpperCase();
    if (code) monthlyByCode.set(code, row);
  }
  const clientUpdatedAtByCode = new Map<string, number>();
  for (const row of clientRows) {
    const code = String(row.codigo || '').trim().toUpperCase();
    const updatedAt = Date.parse(String(row.updated_at || ''));
    if (code && Number.isFinite(updatedAt)) clientUpdatedAtByCode.set(code, updatedAt);
  }

  const codesToRefresh: string[] = [];
  const recentlyAttemptedCodes: string[] = [];
  const seenCodes = new Set<string>();
  for (const rawCode of assignedCodes) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);
    const monthlyRow = monthlyByCode.get(code);
    const invoiceVerifiedAt = Date.parse(String(monthlyRow?.facturas_mes_verificado_en || ''));
    const clientUpdatedAt = clientUpdatedAtByCode.get(code);
    if (
      Number.isFinite(invoiceVerifiedAt)
      && invoiceVerifiedAt >= verifiedAfterMs
      && clientUpdatedAt !== undefined
      && clientUpdatedAt >= verifiedAfterMs
    ) continue;

    const lastAttemptAt = Date.parse(String(monthlyRow?.updated_at || ''));
    if (Number.isFinite(lastAttemptAt) && lastAttemptAt >= retryAfterMs) {
      recentlyAttemptedCodes.push(code);
    } else {
      codesToRefresh.push(code);
    }
  }

  return { codesToRefresh, recentlyAttemptedCodes };
}

/**
 * A prior-month invoice alone is not enough for the daily agenda: the client
 * must also have a verified, positive number of overdue days in the portfolio.
 */
export function filterAgendaCodesByPositiveMora(
  priorInvoiceCodes: Iterable<string>,
  clientRows: Iterable<ClientMoraRow>,
  verifiedAfter: string,
): string[] {
  const verifiedAfterMs = Date.parse(verifiedAfter);
  if (!Number.isFinite(verifiedAfterMs)) return [];

  const positiveMoraCodes = new Set<string>();
  for (const row of clientRows) {
    const code = String(row.codigo || '').trim().toUpperCase();
    const daysInArrears = Number(row.dias_mora);
    const updatedAt = Date.parse(String(row.updated_at || ''));
    if (
      code
      && Number.isFinite(daysInArrears)
      && daysInArrears > 0
      && Number.isFinite(updatedAt)
      && updatedAt >= verifiedAfterMs
    ) {
      positiveMoraCodes.add(code);
    }
  }

  return [...new Set(
    [...priorInvoiceCodes]
      .map((code) => String(code || '').trim().toUpperCase())
      .filter(Boolean),
  )].filter((code) => positiveMoraCodes.has(code));
}
