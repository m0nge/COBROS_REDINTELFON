export interface DailyAgendaCandidate {
  code: string;
}

export interface AgendaInvoiceEligibilityOptions {
  selectedMonthKey: string;
  currentMonthKey: string;
}

export function filterAgendaClientsByPositiveMora<
  T extends DailyAgendaCandidate & { daysArrears?: number },
>(
  clients: T[],
  eligibleClientCodes: Iterable<string>,
): T[] {
  const eligibleCodes = new Set(
    [...eligibleClientCodes]
      .map((code) => String(code || '').trim().toUpperCase())
      .filter(Boolean),
  );
  return clients.filter((client) =>
    eligibleCodes.has(String(client.code || '').trim().toUpperCase())
    && Number.isFinite(Number(client.daysArrears))
    && Number(client.daysArrears) > 0,
  );
}

/**
 * Current and future agenda views require the server-confirmed prior-invoice
 * and positive-mora eligibility. Historical months remain unchanged.
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
  countable: boolean;
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
    seenCodes.add(code);
    return true;
  }).slice(0, Math.max(0, options.target, completedCodes.size));
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
