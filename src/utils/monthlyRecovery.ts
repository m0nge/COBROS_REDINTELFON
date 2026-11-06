export interface MonthlyRecoveryRow {
  estado: string;
  monto_recuperado: number | string | null;
}

export function sumMonthlyRecoveredAmount(rows: readonly MonthlyRecoveryRow[]): number {
  return rows.reduce((sum, row) => {
    if (row.estado !== 'Resuelto') return sum;
    const amount = Number(row.monto_recuperado);
    return sum + (Number.isFinite(amount) ? Math.max(0, amount) : 0);
  }, 0);
}
