import type { ClientManagementHistoryItem, Country, GestionAuditRecord } from '../types';
import { getManagementScheduledDateKey, getRecordDateKey } from './gestionDates';

type HistoryEntry = ClientManagementHistoryItem & {
  timestamp?: string;
};

function stableHistoryId(item: HistoryEntry): string {
  const localAuditId = item.dynamicValues?.localAuditId;
  return typeof localAuditId === 'string' && localAuditId.trim()
    ? `local:${localAuditId.trim()}`
    : `id:${item.id}`;
}

function historyTimestamp(item: HistoryEntry): number {
  const timestamp = Date.parse(item.timestamp || '');
  if (Number.isFinite(timestamp)) return timestamp;

  const dateKey = item.scheduledForDate
    || getRecordDateKey({ timestamp: '', date: item.date })
    || '';
  const dateParts = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateParts) return 0;

  const time = String(item.time || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!time) {
    return Date.UTC(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]));
  }
  let hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = Number(time[3] || 0);
  const meridiem = String(item.time || '').match(/\b([ap])\.?\s*m\.?/i)?.[1]?.toLowerCase();
  if (meridiem === 'p' && hour < 12) hour += 12;
  if (meridiem === 'a' && hour === 12) hour = 0;
  return Date.UTC(
    Number(dateParts[1]),
    Number(dateParts[2]) - 1,
    Number(dateParts[3]),
    hour,
    minute,
    second,
  );
}

function toHistoryEntry(record: GestionAuditRecord): HistoryEntry {
  const values = record.dynamicValues || {};
  const localAuditId = typeof values.localAuditId === 'string' ? values.localAuditId : '';
  const callRound = String(record.callRoundLabel || '').match(/(\d+)\s*[ªº]/);
  return {
    id: localAuditId || record.id,
    agentId: record.agentId,
    timestamp: record.timestamp,
    date: record.date,
    scheduledForDate: record.scheduledForDate || String(values.scheduledForDate || ''),
    time: record.time,
    channel: record.channel,
    callRound: callRound ? Number(callRound[1]) : undefined,
    callRoundLabel: record.callRoundLabel,
    contactSuccess: record.contactSuccess,
    agreement: record.agreement,
    committedAmount: record.committedAmount,
    deadlineDate: record.deadlineDate,
    promiseTime: record.promiseTime,
    contactName: record.contactName,
    contactPhone: record.contactPhone,
    contactEmail: record.contactEmail,
    durationSeconds: record.durationSeconds,
    observations: record.observations,
    agentName: record.agentName,
    aiVerdict: record.aiVerdict,
    aiScore: record.aiScore,
    dynamicValues: values,
    status: record.status,
  };
}

/**
 * Builds the client modal history from persisted audit entries for the selected
 * month. Local cache is used only to enrich a matching persisted row; local-only
 * entries are not presented as confirmed server history.
 */
export function mergeAgentManagementHistory(
  existing: ClientManagementHistoryItem[] | undefined,
  persistedRecords: GestionAuditRecord[],
  country: Country,
  clientCode: string,
  monthKey: string,
): ClientManagementHistoryItem[] {
  const normalizedCode = clientCode.trim().toUpperCase();
  const cachedById = new Map<string, HistoryEntry>(
    (existing || []).map((item) => [stableHistoryId(item), item]),
  );
  const history = new Map<string, HistoryEntry>();

  for (const record of persistedRecords) {
    if (
      record.country !== country
      || record.clientCode.trim().toUpperCase() !== normalizedCode
    ) {
      continue;
    }
    const assignedDate = getManagementScheduledDateKey(record);
    if (!assignedDate || assignedDate.slice(0, 7) !== monthKey) continue;

    const item = toHistoryEntry(record);
    const key = stableHistoryId(item);
    const previous = cachedById.get(key);
    history.set(key, {
      ...previous,
      ...item,
      id: previous?.id || item.id,
    });
  }

  return [...history.values()]
    .sort((left, right) => historyTimestamp(right) - historyTimestamp(left));
}
