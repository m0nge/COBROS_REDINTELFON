import { Client, GestionAuditRecord } from '../types';

export const REPORT_TIME_ZONE = 'America/El_Salvador';

export type ElSalvadorDateParts = {
  year: number;
  month: number;
  day: number;
};

export function getElSalvadorDateParts(date: Date = new Date()): ElSalvadorDateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
  };
}

export function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getElSalvadorDateKey(date: Date = new Date()): string {
  const { year, month, day } = getElSalvadorDateParts(date);
  return toDateKey(year, month, day);
}

export function getRecordDateKey(record: Pick<GestionAuditRecord, 'timestamp' | 'date'>): string | null {
  if (record.timestamp) {
    const timestamp = new Date(record.timestamp);
    if (!Number.isNaN(timestamp.getTime())) return getElSalvadorDateKey(timestamp);
  }

  const rawDate = String(record.date || '').trim();
  const isoDate = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return toDateKey(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));

  const numericDate = rawDate.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (numericDate) return toDateKey(Number(numericDate[3]), Number(numericDate[2]), Number(numericDate[1]));

  const normalizedDate = rawDate
    .toLocaleLowerCase('es-SV')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .replace(/\s+de\s+/g, ' ')
    .trim();
  const spanishDate = normalizedDate.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
  if (!spanishDate) return null;

  const months: Record<string, number> = {
    ene: 1, enero: 1,
    feb: 2, febrero: 2,
    mar: 3, marzo: 3,
    abr: 4, abril: 4,
    may: 5, mayo: 5,
    jun: 6, junio: 6,
    jul: 7, julio: 7,
    ago: 8, agosto: 8,
    sep: 9, sept: 9, septiembre: 9,
    oct: 10, octubre: 10,
    nov: 11, noviembre: 11,
    dic: 12, diciembre: 12,
  };
  const month = months[spanishDate[2]];
  return month
    ? toDateKey(Number(spanishDate[3]), month, Number(spanishDate[1]))
    : null;
}

export function getWeekStartDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function formatMonthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('es-SV', {
    month: 'long',
    year: 'numeric',
    timeZone: REPORT_TIME_ZONE,
  }).format(new Date(Date.UTC(year, month - 1, 15, 12)));
}

export function mergeManagementRecords(
  auditLog: GestionAuditRecord[],
  clients: Client[]
): GestionAuditRecord[] {
  const records = [...auditLog];
  const getSignature = (record: GestionAuditRecord) =>
    `${record.clientCode}-${getRecordDateKey(record) || record.date}-${record.time}`;
  const seen = new Set(records.flatMap((record) => [
    record.id,
    getSignature(record),
  ]).filter(Boolean));

  clients.forEach((client) => {
    (client.managementHistory || []).forEach((history) => {
      if (!history.date || !history.time || !history.agentName) return;

      const key = history.id || `${client.code}-${history.date}-${history.time}`;
      const signature = `${client.code}-${getRecordDateKey({ timestamp: '', date: history.date }) || history.date}-${history.time}`;
      if (seen.has(key) || seen.has(signature)) return;
      seen.add(key);
      seen.add(signature);

      records.push({
        id: key,
        timestamp: '',
        date: history.date,
        time: history.time,
        agentId: '',
        agentName: history.agentName,
        clientCode: client.code,
        clientName: client.name,
        country: client.country,
        channel: history.channel,
        contactSuccess: history.contactSuccess,
        agreement: history.agreement,
        committedAmount: history.committedAmount,
        deadlineDate: history.deadlineDate,
        observations: history.observations,
        aiVerdict: history.aiVerdict,
        aiScore: history.aiScore,
        dynamicValues: history.dynamicValues,
        totalDebt: client.totalDebt,
        callRoundLabel: history.callRoundLabel,
      });
    });
  });

  return records.sort((a, b) => {
    const dateA = getRecordDateKey(a) || '';
    const dateB = getRecordDateKey(b) || '';
    return `${dateB} ${b.time || ''}`.localeCompare(`${dateA} ${a.time || ''}`);
  });
}
