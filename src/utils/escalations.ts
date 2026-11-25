export interface EscalationManagement {
  id: string;
  createdAt: string;
  managedBy: string;
  channel: string;
  contactSuccess: string;
  agreement: string;
  promiseDate: string;
  committedAmount: number;
  observations: string;
  promiseVerificationStatus: string;
  promiseVerifiedAt: string;
}

export interface EscalationFollowUp {
  promiseDate: string;
  reviewFrom: string;
  due: boolean;
  status: 'paid' | 'unpaid' | 'pending';
}

function nextDay(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The admin's latest promise on an escalated client stays visible and becomes
 * reviewable the day after the promised date.
 */
export function getEscalationFollowUp(
  managements: EscalationManagement[],
  todayKey: string,
): EscalationFollowUp | null {
  const latest = [...managements]
    .sort((left, right) => (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0))[0];
  if (!latest || !/^\d{4}-\d{2}-\d{2}$/.test(latest.promiseDate)) return null;
  const reviewFrom = nextDay(latest.promiseDate);
  const status = latest.promiseVerificationStatus === 'paid'
    ? 'paid'
    : latest.promiseVerificationStatus === 'unpaid'
      ? 'unpaid'
      : 'pending';
  return { promiseDate: latest.promiseDate, reviewFrom, due: todayKey >= reviewFrom, status };
}
