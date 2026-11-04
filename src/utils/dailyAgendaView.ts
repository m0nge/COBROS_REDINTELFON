import type { Client, Country, GestionAuditRecord } from '../types';
import type { ScheduledCallSlot } from './moraLogic';

export interface DailyAgendaDisplaySlot extends ScheduledCallSlot {
  management?: GestionAuditRecord;
}

export type DailyAgendaSnapshotSlot = {
  clientCode: string;
  callRound: number;
  callRoundLabel: string;
  timeSlot: string;
};

export type DailyAgendaSnapshotIdentity = {
  agentId: string;
  country: Country;
  dateKey: string;
};

export type DailyAgendaSnapshot = DailyAgendaSnapshotIdentity & {
  version: 1;
  slots: DailyAgendaSnapshotSlot[];
};

type AgendaSnapshotStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function dailyAgendaSnapshotKey(identity: DailyAgendaSnapshotIdentity): string {
  return `red_daily_agenda_v1:${identity.country}:${identity.agentId}:${identity.dateKey}`;
}

export function createDailyAgendaSnapshotSlots(
  slots: DailyAgendaDisplaySlot[],
): DailyAgendaSnapshotSlot[] {
  const seen = new Set<string>();
  return slots.flatMap((slot) => {
    const clientCode = String(slot.client.code || '').trim().toUpperCase();
    if (!clientCode || seen.has(clientCode)) return [];
    seen.add(clientCode);
    return [{
      clientCode,
      callRound: Math.max(1, Number(slot.callRound) || 1),
      callRoundLabel: slot.callRoundLabel || slot.client.callRoundLabel || '1ª Llamada',
      timeSlot: slot.timeSlot || '',
    }];
  });
}

export function readDailyAgendaSnapshot(
  storage: AgendaSnapshotStorage,
  identity: DailyAgendaSnapshotIdentity,
): DailyAgendaSnapshot | null {
  try {
    const raw = storage.getItem(dailyAgendaSnapshotKey(identity));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DailyAgendaSnapshot>;
    if (
      parsed.version !== 1
      || parsed.agentId !== identity.agentId
      || parsed.country !== identity.country
      || parsed.dateKey !== identity.dateKey
      || !Array.isArray(parsed.slots)
    ) {
      return null;
    }
    const seen = new Set<string>();
    const slots = parsed.slots.flatMap((item) => {
      if (!item || typeof item.clientCode !== 'string' || !item.clientCode.trim()) return [];
      const clientCode = item.clientCode.trim().toUpperCase();
      if (seen.has(clientCode)) return [];
      seen.add(clientCode);
      return [{
        clientCode,
        callRound: Math.max(1, Number(item.callRound) || 1),
        callRoundLabel: String(item.callRoundLabel || '1ª Llamada'),
        timeSlot: String(item.timeSlot || ''),
      }];
    });
    return slots.length > 0 ? { ...identity, version: 1, slots } : null;
  } catch {
    return null;
  }
}

export function writeDailyAgendaSnapshot(
  storage: AgendaSnapshotStorage,
  identity: DailyAgendaSnapshotIdentity,
  slots: DailyAgendaSnapshotSlot[],
): boolean {
  if (!identity.agentId || slots.length === 0) return false;
  const snapshot: DailyAgendaSnapshot = {
    ...identity,
    version: 1,
    slots,
  };
  try {
    const key = dailyAgendaSnapshotKey(identity);
    if (readDailyAgendaSnapshot(storage, identity)) return true;
    storage.setItem(key, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
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

/**
 * Replays the day's original assignment order while overlaying confirmed
 * management records in-place. It never substitutes a newly refilled client.
 */
export function buildDailyAgendaDisplaySlotsFromSnapshot(
  snapshotSlots: DailyAgendaSnapshotSlot[],
  currentPendingSlots: ScheduledCallSlot[],
  managedRecords: GestionAuditRecord[],
  clients: Client[],
  country: Country,
  selectedDay: number,
): DailyAgendaDisplaySlot[] {
  const pendingByCode = new Map(
    currentPendingSlots.map((slot) => [
      `${slot.client.country}:${slot.client.code.toUpperCase()}`,
      slot,
    ]),
  );
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
      if (!existing || recordTime(record) >= recordTime(existing)) managedByCode.set(key, record);
    });

  return snapshotSlots.flatMap((snapshotSlot, index) => {
    const key = `${country}:${snapshotSlot.clientCode.toUpperCase()}`;
    const management = managedByCode.get(key);
    const currentSlot = pendingByCode.get(key);
    const sourceClient = currentSlot?.client || clientsByCode.get(key);
    const client = management ? clientFromRecord(management, sourceClient) : sourceClient;
    if (!client) return [];

    const callRound = Math.max(1, Number(snapshotSlot.callRound) || currentSlot?.callRound || 1);
    const callRoundLabel = snapshotSlot.callRoundLabel || currentSlot?.callRoundLabel || '1ª Llamada';
    return [{
      ...(currentSlot || {
        client,
        scheduledDay: selectedDay,
        callRound,
        callRoundLabel,
        turnNumber: index + 1,
        timeSlot: snapshotSlot.timeSlot,
      }),
      client: { ...client, scheduledDay: selectedDay, callRound, callRoundLabel },
      scheduledDay: selectedDay,
      callRound,
      callRoundLabel,
      turnNumber: index + 1,
      timeSlot: snapshotSlot.timeSlot || currentSlot?.timeSlot || '',
      management,
    }];
  });
}
