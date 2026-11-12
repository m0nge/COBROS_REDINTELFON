export interface ClientMoraRow {
  codigo?: unknown;
  dias_mora?: unknown;
  updated_at?: unknown;
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
