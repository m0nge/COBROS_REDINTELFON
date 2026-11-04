export interface DailyAgendaCandidate {
  code: string;
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
