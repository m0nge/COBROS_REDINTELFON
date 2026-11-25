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

export function filterAgendaClientsByInvoiceEligibility<
  T extends DailyAgendaCandidate & { daysArrears?: number; moraRange?: MoraRange },
>(
  clients: T[],
  eligibleClientCodes: Iterable<string>,
  verifiedMoraByCode: Record<string, number>,
  options: AgendaInvoiceEligibilityOptions,
): Array<T & { daysArrears: number; moraRange: MoraRange }> | T[] {
  if (options.selectedMonthKey < options.currentMonthKey) return clients;

  const eligibleCodes = new Set(
    [...eligibleClientCodes]
      .map((code) => String(code || '').trim().toUpperCase())
      .filter(Boolean),
  );
  return filterAgendaClientsByVerifiedMora(clients, verifiedMoraByCode)
    .filter((client) => eligibleCodes.has(String(client.code || '').trim().toUpperCase()));
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

/**
 * Overdue promises and reschedules still need verified overdue debt: a client
 * that only owes the current month's invoice is settled until next month.
 */
export function keepEligibleAgendaFollowUps(
  codes: Iterable<string>,
  eligibleClientCodes: Iterable<string>,
): string[] {
  const eligibleCodes = new Set(
    [...eligibleClientCodes].map((code) => String(code || '').trim().toUpperCase()),
  );
  return [...codes].filter((value) =>
    eligibleCodes.has(String(value || '').trim().toUpperCase()),
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
  rescheduleDate?: string | null;
  status?: string | null;
  timestamp?: string | null;
  countable: boolean;
}

export function buildLatestExplicitRescheduleDates(
  records: Iterable<FutureAgendaManagementRecord>,
  monthKey: string,
): Map<string, string | null> {
  const latestByClient = new Map<string, FutureAgendaManagementRecord>();
  for (const record of records) {
    if (!record.countable || String(record.assignedDate || '').slice(0, 7) !== monthKey) continue;
    const code = String(record.clientCode || '').trim().toUpperCase();
    if (!code) continue;
    const existing = latestByClient.get(code);
    const recordTime = Date.parse(String(record.timestamp || '')) || 0;
    const existingTime = Date.parse(String(existing?.timestamp || '')) || 0;
    if (!existing || recordTime >= existingTime) latestByClient.set(code, record);
  }

  const rescheduleDates = new Map<string, string | null>();
  latestByClient.forEach((record, code) => {
    const date = String(record.rescheduleDate || '').slice(0, 10);
    rescheduleDates.set(code, (
      record.status === 'Reprogramado'
      && /^\d{4}-\d{2}-\d{2}$/.test(date)
      && date.slice(0, 7) === monthKey
    ) ? date : null);
  });
  return rescheduleDates;
}

export interface LateMonthFollowUpOptions {
  dateKey: string;
  completedCodes: Iterable<string>;
  resolvedCodes: Iterable<string>;
  unavailablePromiseCodes: Iterable<string>;
  overdueUnpaidPromiseCodes: Iterable<string>;
  uncontactedCodes?: Iterable<string>;
  explicitDateByCode?: ReadonlyMap<string, string | null>;
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

/**
 * Mirrors Acuerdos' "Vencido" status: a promise verified unpaid by SAN stays a
 * daily follow-up until it is paid or replaced by a newer promise. Later
 * contact attempts or reschedules do not hide a broken promise.
 */
export function buildOverdueUnpaidPromiseCodes(
  records: Iterable<FutureAgendaManagementRecord>,
  dateKey: string,
): Set<string> {
  const latestByClient = new Map<string, FutureAgendaManagementRecord>();
  const latestPromiseByClient = new Map<string, FutureAgendaManagementRecord>();
  const isNewer = (record: FutureAgendaManagementRecord, existing?: FutureAgendaManagementRecord) =>
    !existing
    || (Date.parse(String(record.timestamp || '')) || 0) > (Date.parse(String(existing.timestamp || '')) || 0);
  for (const record of records) {
    if (!record.countable) continue;
    const code = String(record.clientCode || '').trim().toUpperCase();
    if (!code) continue;
    if (isNewer(record, latestByClient.get(code))) latestByClient.set(code, record);
    const agreement = String(record.agreement || '').toLocaleLowerCase();
    if (
      (agreement.includes('promesa') || agreement.includes('negociación'))
      && isNewer(record, latestPromiseByClient.get(code))
    ) {
      latestPromiseByClient.set(code, record);
    }
  }

  const overdueCodes = new Set<string>();
  latestPromiseByClient.forEach((record, code) => {
    const promiseDate = String(record.deadlineDate || '').slice(0, 10);
    const verifiedDate = dateKeyInElSalvador(String(record.promiseVerifiedAt || ''));
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(promiseDate)
      || dateKey <= promiseDate
      || record.promiseVerificationStatus !== 'unpaid'
      || (verifiedDate && dateKey < verifiedDate)
    ) return;

    const latest = latestByClient.get(code);
    const latestAgreement = String(latest?.agreement || '').toLocaleLowerCase();
    if (latestAgreement.includes('pago realizado') || latest?.paymentOutcome === 'payment_received') return;
    overdueCodes.add(code);
  });

  return overdueCodes;
}

export function buildNoPromiseFollowUpCodes(
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

  const followUpCodes = new Set<string>();
  latestByClient.forEach((record, code) => {
    const assignedDate = String(record.assignedDate || '').slice(0, 10)
      || dateKeyInElSalvador(String(record.timestamp || ''));
    const agreement = String(record.agreement || '').toLocaleLowerCase();
    const isPromise = agreement.includes('promesa') || agreement.includes('negociación');
    const isPayment = agreement.includes('pago realizado')
      || record.paymentOutcome === 'payment_received';
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(assignedDate)
      && assignedDate < dateKey
      && !isPromise
      && !isPayment
    ) {
      followUpCodes.add(code);
    }
  });
  return followUpCodes;
}

/**
 * After the intensive window, only due reschedules and promises verified
 * unpaid by SAN return to the agenda.
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
  const uncontactedCodes = normalizeCodes(options.uncontactedCodes || []);
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
  const overdueCodes: string[] = [];
  const uncontactedFollowUps: string[] = [];
  const rescheduledCodes: string[] = [];
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
    const rescheduledForDate = Boolean(explicitDate && explicitDate <= options.dateKey);
    const overduePromise = overdueUnpaidPromiseCodes.has(code);
    const noSuccessfulContact = uncontactedCodes.has(code);
    if (
      (!rescheduledForDate && !overduePromise && !noSuccessfulContact)
      || (noSuccessfulContact && explicitDate && explicitDate > options.dateKey && !overduePromise)
    ) continue;
    const latest = latestBeforeDate.get(code);
    const agreement = String(latest?.agreement || '').toLocaleLowerCase();
    const promiseDate = String(latest?.deadlineDate || '').slice(0, 10);
    const hasValidLatestPromise = (
      agreement.includes('promesa') || agreement.includes('negociación')
    ) && /^\d{4}-\d{2}-\d{2}$/.test(promiseDate);
    if (hasValidLatestPromise && !overduePromise) continue;
    if (overduePromise) overdueCodes.push(code);
    else if (rescheduledForDate) rescheduledCodes.push(code);
    else if (noSuccessfulContact) uncontactedFollowUps.push(code);
  }

  return [...overdueCodes, ...rescheduledCodes, ...uncontactedFollowUps];
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
  priorityCodes?: Set<string>;
}

export interface PreserveCompletedDailySlotsOptions {
  target: number;
  dateKey: string;
  completedCodes: Set<string>;
  resolvedCodes: Set<string>;
  completedDailySlotKeys: Set<string>;
}

export interface DailyAgendaPriorityOptions {
  dateKey: string;
  explicitDateByCode: Map<string, string>;
  overdueUnpaidPromiseCodes: Set<string>;
  noSuccessfulContactCodes?: Set<string>;
  noPromiseFollowUpCodes?: Set<string>;
  completedCodes: Set<string>;
  unavailableCodes: Set<string>;
}

export interface DailyAgendaPriorityRecord extends FutureAgendaManagementRecord {
  callRoundLabel?: string;
}

export interface DailyAgendaPriorityPlanOptions {
  dateKey: string;
  explicitDateByCode: Map<string, string>;
  overdueUnpaidPromiseCodes: Set<string>;
  noSuccessfulContactCodes?: Set<string>;
  noPromiseFollowUpCodes?: Set<string>;
  unavailableCodes: Set<string>;
  protectStartedDay?: boolean;
}

export function buildDailyAgendaPriorityCodes(
  candidateCodes: Iterable<string>,
  options: DailyAgendaPriorityOptions,
): string[] {
  const normalize = (codes: Set<string>) => new Set(
    [...codes].map((code) => String(code || '').trim().toUpperCase()),
  );
  const completedCodes = normalize(options.completedCodes);
  const unavailableCodes = normalize(options.unavailableCodes);
  const overdueCodes = normalize(options.overdueUnpaidPromiseCodes);
  const noContactCodes = normalize(options.noSuccessfulContactCodes || new Set());
  const noPromiseFollowUpCodes = normalize(options.noPromiseFollowUpCodes || new Set());
  const explicitDates = new Map(
    [...options.explicitDateByCode].map(([code, date]) => [
      String(code || '').trim().toUpperCase(),
      date,
    ]),
  );
  const orderedCandidates = [...new Set(
    [...candidateCodes].map((code) => String(code || '').trim().toUpperCase()).filter(Boolean),
  )];
  const eligibleCodes = orderedCandidates.filter((code) =>
    !completedCodes.has(code) && !unavailableCodes.has(code),
  );
  const overdue = eligibleCodes.filter((code) => overdueCodes.has(code));
  const noContact = eligibleCodes.filter((code) =>
    !overdueCodes.has(code)
    && (noContactCodes.has(code) || noPromiseFollowUpCodes.has(code))
    && !explicitDates.has(code),
  );
  const rescheduled = eligibleCodes.filter((code) =>
    !overdueCodes.has(code)
    && Boolean(explicitDates.get(code) && explicitDates.get(code)! <= options.dateKey),
  );
  return [...overdue, ...rescheduled, ...noContact];
}

export function buildDailyAgendaPriorityPlan(
  candidateCodes: Iterable<string>,
  records: Iterable<DailyAgendaPriorityRecord>,
  options: DailyAgendaPriorityPlanOptions,
): { codes: string[]; labelsByCode: Map<string, string>; overdueCodes: Set<string> } {
  const normalizeCode = (value: string) => String(value || '').trim().toUpperCase();
  const allRecords = [...records];
  const currentDayRecords = options.protectStartedDay
    ? allRecords.filter((record) =>
      record.countable && String(record.assignedDate || '').slice(0, 10) === options.dateKey,
    )
    : [];
  const labelsByCode = new Map<string, string>();
  const completedOverdueCodes: string[] = [];
  const completedRescheduledCodes: string[] = [];
  [...currentDayRecords]
    .sort((left, right) =>
      (Date.parse(left.timestamp || '') || 0) - (Date.parse(right.timestamp || '') || 0)
    )
    .forEach((record) => {
      const code = normalizeCode(record.clientCode);
      if (record.callRoundLabel === 'Seguimiento de promesa vencida') {
        completedOverdueCodes.push(code);
        labelsByCode.set(code, record.callRoundLabel);
      } else if (record.callRoundLabel === 'Reprogramación programada') {
        completedRescheduledCodes.push(code);
        labelsByCode.set(code, record.callRoundLabel);
      }
    });

  const overdueCodes = new Set(
    [...options.overdueUnpaidPromiseCodes].map(normalizeCode),
  );
  const explicitDates = new Map(
    [...options.explicitDateByCode].map(([code, date]) => [normalizeCode(code), date]),
  );
  const firstManagementTimestamp = currentDayRecords.reduce((earliest, record) => {
    const timestamp = Date.parse(record.timestamp || '');
    return Number.isFinite(timestamp) && timestamp > 0
      ? Math.min(earliest, timestamp)
      : earliest;
  }, Number.POSITIVE_INFINITY);

  if (Number.isFinite(firstManagementTimestamp)) {
    [...overdueCodes].forEach((code) => {
      const verifiedAt = allRecords
        .filter((record) =>
          normalizeCode(record.clientCode) === code
          && record.promiseVerificationStatus === 'unpaid',
        )
        .map((record) => Date.parse(record.promiseVerifiedAt || ''))
        .filter((timestamp) => Number.isFinite(timestamp));
      if (verifiedAt.some((timestamp) => timestamp > firstManagementTimestamp)) {
        overdueCodes.delete(code);
      }
    });
    [...explicitDates].forEach(([code, rescheduleDate]) => {
      const latestReschedule = allRecords
        .filter((record) =>
          normalizeCode(record.clientCode) === code
          && record.status === 'Reprogramado'
          && record.rescheduleDate === rescheduleDate,
        )
        .sort((left, right) =>
          (Date.parse(right.timestamp || '') || 0) - (Date.parse(left.timestamp || '') || 0)
        )[0];
      const createdAt = Date.parse(latestReschedule?.timestamp || '');
      if (Number.isFinite(createdAt) && createdAt > firstManagementTimestamp) {
        explicitDates.delete(code);
      }
    });
  }

  const activeCodes = buildDailyAgendaPriorityCodes(candidateCodes, {
    dateKey: options.dateKey,
    explicitDateByCode: explicitDates,
    overdueUnpaidPromiseCodes: overdueCodes,
    noSuccessfulContactCodes: options.noSuccessfulContactCodes,
    noPromiseFollowUpCodes: options.noPromiseFollowUpCodes,
    completedCodes: new Set<string>(),
    unavailableCodes: options.unavailableCodes,
  });
  const activeOverdueCodes = activeCodes.filter((code) => overdueCodes.has(code));
  const noContactCodes = new Set(
    [...(options.noSuccessfulContactCodes || new Set<string>())].map(normalizeCode),
  );
  const noPromiseFollowUpCodes = new Set(
    [...(options.noPromiseFollowUpCodes || new Set<string>())].map(normalizeCode),
  );
  const activeNoContactCodes = activeCodes.filter((code) =>
    !overdueCodes.has(code)
    && !explicitDates.has(code)
    && (noContactCodes.has(code) || noPromiseFollowUpCodes.has(code)),
  );
  activeNoContactCodes.forEach((code) => labelsByCode.set(
    code,
    noContactCodes.has(code) ? 'Seguimiento sin contacto' : 'Seguimiento sin promesa',
  ));
  const activeRescheduledCodes = activeCodes.filter((code) =>
    !overdueCodes.has(code)
    && Boolean(explicitDates.get(code) && explicitDates.get(code)! <= options.dateKey),
  );
  const codes = [...new Set([
    ...completedOverdueCodes,
    ...activeOverdueCodes,
    ...completedRescheduledCodes,
    ...activeRescheduledCodes,
    ...activeNoContactCodes,
  ])];

  return { codes, labelsByCode, overdueCodes };
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
        Number(options.priorityCodes?.has(right.code) || false)
          - Number(options.priorityCodes?.has(left.code) || false)
        || (callCounts.get(left.code) || 0) - (callCounts.get(right.code) || 0)
        || (options.priorityIndex.get(left.code) || 0) - (options.priorityIndex.get(right.code) || 0)
      )[0];
    if (!candidate) break;

    selected.push(candidate);
    selectedCodes.add(candidate.code);
    callCounts.set(candidate.code, (callCounts.get(candidate.code) || 0) + 1);
  }

  return selected;
}
