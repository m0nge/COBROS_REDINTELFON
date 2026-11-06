export interface VerifiedCurrentMonthBalance {
  invoiceDataAvailable?: unknown;
  invoiceBalancesComplete?: unknown;
  summary?: {
    mesPendientesMonto?: unknown;
  } | null;
}

export function isCurrentMonthBalanceCleared(
  data: VerifiedCurrentMonthBalance | null | undefined,
): boolean {
  if (data?.invoiceDataAvailable !== true || data.invoiceBalancesComplete !== true) return false;
  const rawAmount = data.summary?.mesPendientesMonto;
  if (rawAmount === null || rawAmount === undefined || rawAmount === '') return false;
  const amount = Number(rawAmount);
  return Number.isFinite(amount) && amount <= 0.01;
}
