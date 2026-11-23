import type { MoraRange } from '../types';
import { calculateMoraRange } from './moraLogic';

export interface DailyAgendaCandidate {
  code: string;
}

export interface AgendaInvoiceEligibilityOptions {
  selectedMonthKey: string;
  currentMonthKey: string;
}

export function filterAgendaClientsByVerifiedMora<
  T extends DailyAgendaCandidate & { daysArrears?: number; moraRange?: MoraRange },
>(
  clients: T[],
  verifiedMoraByCode: Record<string, number>,
): Array<T & { daysArrears: number; moraRange: MoraRange }> {
  return clients.flatMap((client) => {
    const code = String(client.code || '').trim().toUpperCase();
    const daysArrears = Number(verifiedMoraByCode[code]);
    if (!code || !Number.isFinite(daysArrears) || daysArrears <= 0) return [];
    return [{
      ...client,
      daysArrears,
      moraRange: calculateMoraRange(daysArrears),
    }];
  });
}

/**
 * Filters slots against the eligibility snapshot selected by the caller:
 * fresh data for current/future dates and last-known data for past dates.
 */
export function filterAgendaSlotsByPriorInvoice<
  T extends { client: DailyAgendaCandidate },
>(
  slots: T[],
  eligibleClientCodes: Iterable<string>,
  options: AgendaInvoiceEligibilityOptions,
): T[] {
  if (options.selectedMonthKey < options.currentMonthKey) {
    return slots;
  }
  const eligibleCodes = new Set(
    [...eligibleClientCodes]
      .map((code) => String(code || '').trim().toUpperCase())
      .filter(Boolean),
  );
  return slots.filter((slot) =>
    eligibleCodes.has(String(slot.client.code || '').trim().toUpperCase()),
  );
}

export interface FutureAgendaManagementRecord {
  clientCode: string;
  agreement?: string | null;
  paymentOutcome?: string | null;
  assignedDate?: string | null;
  deadlineDate?: string | null;
  promiseVerificationStatus?: string | null;
  promiseVerifiedAt?: string | null;
  timestamp?: string | null;
  countable: boolean;
}

export interface LateMonthFollowUpOptions {
  dateKey: string;
  completedCodes: Iterable<string>;
  resolvedCodes: Iterable<string>;
  unavailablePromiseCodes: Iterable<string>;
  overdueUnpaidPromiseCodes: Iterable<string>;
  explicitDateByCode?: ReadonlyMap<string, string>;
}

/**
 * Promise records are completed for their own date, not resolved for the month.
 * Keep them eligible for future follow-ups; only monthly-resolved clients and
 * valid payment records should be unavailable to future pending agendas.
 */
export function buildFutureAgendaUnavailableCodes(
  monthlyResolvedCodes: Iterable<string>,
  managementRecords: Iterable<FutureAgendaManagementRecord>,
  monthKey: string,
): Set<string> {
  const unavailableCodes = new Set(
    [...monthlyResolvedCodes]
      .map((code) => String(code || '').trim().toUpperCase())
      .filter(Boolean),
  );

  for (const record of managementRecords) {
    if (!record.countable) continue;
    const agreement = String(record.agreement || '').toLocaleLowerCase();
    const isPayment = agreement.includes('pago realizado')
      || record.paymentOutcome === 'payment_received';
    if (!isPayment || String(record.assignedDate || '').slice(0, 7) !== monthKey) continue;

    const code = String(record.clientCode || '').trim().toUpperCase();
    if (code) unavailableCodes.add(code);
  }

  return unavailableCodes;
}

/**
 * Keeps a promised client out of later daily lists through the promised date.
 * From the following day, the client is released only after SAN confirms the
 * promise was not fulfilled; paid or unverified promises remain unavailable.
 */
export function buildPromiseUnavailableCodes(
  records: Iterable<FutureAgendaManagementRecord>,
  dateKey: string,
): Set<string> {
  const latestByClient = new Map<string, FutureAgendaManagementRecord>();
  for (const record of records) {
    if (!record.countable) continue;
    const code = String(record.clientCode || '').trim().toUpperCase();
    if (!code) continue;
    const existing = latestByClient.get(code);
    const recordTime = Date.parse(String(record.timestamp || '')) || 0;
    const existingTime = Date.parse(String(existing?.timestamp || '')) || 0;
    if (!existing || recordTime > existingTime) latestByClient.set(code, record);
  }

  const unavailableCodes = new Set<string>();
  latestByClient.forEach((record, code) => {
    const agreement = String(record.agreement || '').toLocaleLowerCase();
    if (!agreement.includes('promesa') && !agreement.includes('negociación')) return;

    const managementDate = String(record.assignedDate || '').slice(0, 10);
    const promiseDate = String(record.deadlineDate || '').slice(0, 10);
    const verifiedDate = dateKeyInElSalvador(String(record.promiseVerifiedAt || ''));
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(managementDate)
      || !/^\d{4}-\d{2}-\d{2}$/.test(promiseDate)
      || dateKey <= managementDate
    ) return;

    const verificationStatus = String(record.promiseVerificationStatus || '');
    if (
      verificationStatus === 'unpaid'
      && dateKey > promiseDate
      && (!verifiedDate || dateKey >= verifiedDate)
    ) return;
    unavailableCodes.add(code);
  });

  return unavailableCodes;
}

export function buildOverdueUnpaidPromiseCodes(
  records: Iterable<FutureAgendaManagementRecord>,
  dateKey: string,
): Set<string> {
  const latestByClient = new Map<string, FutureAgendaManagementRecord>();
  for (const record of records) {
    if (!record.countable) continue;
    const code = String(record.clientCode || '').trim().toUpperCase();
    if (!code) continue;
    const existing = latestByClient.get(code);
    const recordTime = Date.parse(String(record.timestamp || '')) || 0;
    const existingTime = Date.parse(String(existing?.timestamp || '')) || 0;
    if (!existing || recordTime > existingTime) latestByClient.set(code, record);
  }

  const overdueCodes = new Set<string>();
  latestByClient.forEach((record, code) => {
    const agreement = String(record.agreement || '').toLocaleLowerCase();
    const promiseDate = String(record.deadlineDate || '').slice(0, 10);
    const verifiedDate = dateKeyInElSalvador(String(record.promiseVerifiedAt || ''));
    if (
      (!agreement.includes('promesa') && !agreement.includes('negociación'))
      || !/^\d{4}-\d{2}-\d{2}$/.test(promiseDate)
      || dateKey <= promiseDate
      || record.promiseVerificationStatus !== 'unpaid'
      || (verifiedDate && dateKey < verifiedDate)
    ) return;
    overdueCodes.add(code);
  });

  return overdueCodes;
}

/**
 * Late-month queues include unresolved candidates again on the next business
 * day after a no-promise management, while valid promises stay held until
 * SAN verifies that they are overdue and unpaid.
 */
export function buildLateMonthFollowUpCodes(
  candidateCodes: Iterable<string>,
  records: Iterable<FutureAgendaManagementRecord>,
  options: LateMonthFollowUpOptions,
): string[] {
  const normalizeCodes = (codes: Iterable<string>) => new Set(
    [...codes].map((code) => String(code || '').trim().toUpperCase()).filter(Boolean),
  );
  const completedCodes = normalizeCodes(options.completedCodes);
  const resolvedCodes = normalizeCodes(options.resolvedCodes);
  const unavailablePromiseCodes = normalizeCodes(options.unavailablePromiseCodes);
  const overdueUnpaidPromiseCodes = normalizeCodes(options.overdueUnpaidPromiseCodes);
  const explicitDateByCode = new Map(
    [...(options.explicitDateByCode || new Map())].map(([code, date]) => [
      String(code || '').trim().toUpperCase(),
      date,
    ]),
  );
  const latestBeforeDate = new Map<string, FutureAgendaManagementRecord>();

  for (const record of records) {
    if (!record.countable) continue;
    const code = String(record.clientCode || '').trim().toUpperCase();
    if (!code) continue;
    const recordDate = String(record.assignedDate || '').slice(0, 10)
      || dateKeyInElSalvador(String(record.timestamp || ''));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate) || recordDate >= options.dateKey) continue;

    const existing = latestBeforeDate.get(code);
    const existingDate = String(existing?.assignedDate || '').slice(0, 10)
      || dateKeyInElSalvador(String(existing?.timestamp || ''));
    const recordTime = Date.parse(String(record.timestamp || '')) || 0;
    const existingTime = Date.parse(String(existing?.timestamp || '')) || 0;
    if (!existing || recordDate > existingDate || (recordDate === existingDate && recordTime > existingTime)) {
      latestBeforeDate.set(code, record);
    }
  }

  const seenCodes = new Set<string>();
  const followUpCodes: string[] = [];
  for (const value of candidateCodes) {
    const code = String(value || '').trim().toUpperCase();
    if (
      !code
      || seenCodes.has(code)
      || completedCodes.has(code)
      || resolvedCodes.has(code)
      || unavailablePromiseCodes.has(code)
    ) continue;
    seenCodes.add(code);

    const explicitDate = explicitDateByCode.get(code);
    if (explicitDate && explicitDate > options.dateKey) continue;
    const latest = latestBeforeDate.get(code);
    const agreement = String(latest?.agreement || '').toLocaleLowerCase();
    const promiseDate = String(latest?.deadlineDate || '').slice(0, 10);
    const hasValidLatestPromise = (
      agreement.includes('promesa') || agreement.includes('negociación')
    ) && /^\d{4}-\d{2}-\d{2}$/.test(promiseDate);
    if (hasValidLatestPromise && !overdueUnpaidPromiseCodes.has(code)) continue;

    followUpCodes.push(code);
  }

  return followUpCodes;
}

function dateKeyInElSalvador(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

export function calculateDailyAgendaProgress(
  completedCount: number,
  assignedCount: number,
  quota: number,
  fixedQuotaApplies: boolean,
): { goal: number; percentage: number; shortfall: number } {
  const assigned = Math.max(0, assignedCount);
  const goal = fixedQuotaApplies ? Math.min(quota, assigned) : assigned;
  const percentage = goal > 0
    ? Math.min(100, Math.max(0, (completedCount / goal) * 100))
    : 0;
  return {
    goal,
    percentage: Number(percentage.toFixed(1)),
    shortfall: fixedQuotaApplies ? Math.max(0, quota - assigned) : 0,
  };
}

export interface DailyAgendaRefillOptions {
  target: number;
  dateKey: string;
  currentCodes: Set<string>;
  unavailableCodes: Set<string>;
  completedDailySlotKeys: Set<string>;
  explicitDateByCode: Map<string, string>;
  plannedCallCounts: Map<string, number>;
  priorityIndex: Map<string, number>;
}

export interface PreserveCompletedDailySlotsOptions {
  target: number;
  dateKey: string;
  completedCodes: Set<string>;
  resolvedCodes: Set<string>;
  completedDailySlotKeys: Set<string>;
}

/**
 * Keeps today's completed work in its original assigned slot. Resolved clients
 * remain suppressed on other days, but completing today's slot must not cause
 * the daily assignment to be replaced or reordered.
 */
export function preserveCompletedDailySlots<T extends { client: DailyAgendaCandidate }>(
  slots: T[],
  options: PreserveCompletedDailySlotsOptions,
): T[] {
  const completedCodes = new Set(
    [...options.completedCodes].map((code) => String(code || '').trim().toUpperCase()).filter(Boolean),
  );
  const resolvedCodes = new Set(
    [...options.resolvedCodes].map((code) => String(code || '').trim().toUpperCase()).filter(Boolean),
  );
  const seenCodes = new Set<string>();
  let pendingCount = 0;
  const pendingLimit = Math.max(0, options.target - completedCodes.size);

  return slots.filter((slot) => {
    const code = String(slot.client.code || '').trim().toUpperCase();
    if (!code || seenCodes.has(code)) return false;
    const completedToday = completedCodes.has(code);
    if (
      !completedToday
      && (
        resolvedCodes.has(code)
        || options.completedDailySlotKeys.has(`${options.dateKey}:${code}`)
      )
    ) {
      return false;
    }
    if (!completedToday && pendingCount >= pendingLimit) return false;
    seenCodes.add(code);
    if (!completedToday) pendingCount += 1;
    return true;
  });
}

/**
 * Selects unique replacement clients until a daily quota is met, while
 * respecting completed work, monthly resolutions, and explicit reschedules.
 */
export function selectDailyAgendaRefillCandidates<T extends DailyAgendaCandidate>(
  candidates: T[],
  options: DailyAgendaRefillOptions,
): T[] {
  const selected: T[] = [];
  const selectedCodes = new Set(options.currentCodes);
  const callCounts = new Map(options.plannedCallCounts);
  const remainingSlots = Math.max(0, options.target - selectedCodes.size);

  while (selected.length < remainingSlots) {
    const candidate = candidates
      .filter((client) => {
        const explicitDate = options.explicitDateByCode.get(client.code);
        return !selectedCodes.has(client.code)
          && !options.unavailableCodes.has(client.code)
          && !options.completedDailySlotKeys.has(`${options.dateKey}:${client.code}`)
          && (!explicitDate || explicitDate === options.dateKey);
      })
      .sort((left, right) =>
        (callCounts.get(left.code) || 0) - (callCounts.get(right.code) || 0)
        || (options.priorityIndex.get(left.code) || 0) - (options.priorityIndex.get(right.code) || 0)
      )[0];
    if (!candidate) break;

    selected.push(candidate);
    selectedCodes.add(candidate.code);
    callCounts.set(candidate.code, (callCounts.get(candidate.code) || 0) + 1);
  }

  return selected;
}
