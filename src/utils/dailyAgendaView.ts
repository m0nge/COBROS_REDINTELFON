import type { Client, GestionAuditRecord } from '../types';
import type { ScheduledCallSlot } from './moraLogic';

export interface DailyAgendaDisplaySlot extends ScheduledCallSlot {
  management?: GestionAuditRecord;
}

function recordTime(record: GestionAuditRecord): number {
  const timestamp = Date.parse(record.timestamp || '');
  if (Number.isFinite(timestamp)) return timestamp;
  const time = Date.parse(`${record.scheduledForDate || record.date} ${record.time || ''}`);
  return Number.isFinite(time) ? time : 0;
}

function getCallRound(record: GestionAuditRecord, fallback: number): number {
  const match = String(record.callRoundLabel || '').match(/(\d+)\s*[ªº]/);
  return match ? Number(match[1]) : fallback;
}

function clientFromRecord(record: GestionAuditRecord, source?: Client): Client {
  const callRound = getCallRound(record, source?.callRound || 1);
  const callRoundLabel = record.callRoundLabel || 'Gestión registrada';
  if (source) {
    return {
      ...source,
      scheduledDate: record.scheduledForDate || source.scheduledDate,
      scheduledDay: record.scheduledForDate
        ? Number(record.scheduledForDate.slice(8, 10))
        : source.scheduledDay,
      callRound,
      callRoundLabel,
    };
  }

  return {
    code: record.clientCode,
    name: record.clientName || record.clientCode,
    country: record.country,
    totalDebt: Number(record.totalDebt) || 0,
    debtVerified: false,
    daysArrears: 0,
    moraRange: '0-30',
    state: 'Resuelto',
    priority: 'Normal',
    invoiceDate: '',
    dueDate: '',
    scheduledDate: record.scheduledForDate,
    scheduledDay: record.scheduledForDate
      ? Number(record.scheduledForDate.slice(8, 10))
      : undefined,
    callRound,
    callRoundLabel,
  };
}

/**
 * Keeps already-managed clients visible alongside the remaining work for a day.
 * A client is shown once; if multiple valid records exist, its latest one opens
 * as the detail for that row.
 */
export function buildDailyAgendaDisplaySlots(
  pendingSlots: ScheduledCallSlot[],
  managedRecords: GestionAuditRecord[],
  clients: Client[],
  selectedDay: number,
): DailyAgendaDisplaySlot[] {
  const clientsByCode = new Map(
    clients.map((client) => [`${client.country}:${client.code.toUpperCase()}`, client]),
  );
  const managedByCode = new Map<string, GestionAuditRecord>();

  managedRecords
    .slice()
    .sort((left, right) => recordTime(left) - recordTime(right))
    .forEach((record) => {
      const key = `${record.country}:${record.clientCode.toUpperCase()}`;
      const existing = managedByCode.get(key);
      if (!existing || recordTime(record) >= recordTime(existing)) {
        managedByCode.set(key, record);
      }
    });

  const managedSlots: DailyAgendaDisplaySlot[] = [...managedByCode.values()]
    .sort((left, right) => recordTime(left) - recordTime(right))
    .map((record, index) => {
      const source = clientsByCode.get(`${record.country}:${record.clientCode.toUpperCase()}`);
      const client = clientFromRecord(record, source);
      return {
        client,
        scheduledDay: selectedDay,
        callRound: client.callRound || 1,
        callRoundLabel: record.callRoundLabel || client.callRoundLabel || 'Gestión registrada',
        turnNumber: index + 1,
        timeSlot: record.time || '',
        management: record,
      };
    });

  const managedCodes = new Set(
    [...managedByCode.values()].map((record) => `${record.country}:${record.clientCode.toUpperCase()}`),
  );
  const pendingEntries = pendingSlots
    .filter((slot) => !managedCodes.has(`${slot.client.country}:${slot.client.code.toUpperCase()}`))
    .map((slot) => ({ ...slot }));

  return [...managedSlots, ...pendingEntries].map((slot, index) => ({
    ...slot,
    turnNumber: index + 1,
  }));
}
