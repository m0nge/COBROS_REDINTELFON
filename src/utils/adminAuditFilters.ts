import { GestionAuditRecord } from '../types';
import { getRecordDateKey } from './gestionDates';

export function filterAgentAuditRecordsForSelectedDay(
  records: GestionAuditRecord[],
  selectedDayKey: string,
  channelFilter = 'TODOS',
  searchTerm = '',
): GestionAuditRecord[] {
  const query = searchTerm.trim().toLowerCase();

  return records.filter((record) => {
    if (getRecordDateKey(record) !== selectedDayKey) return false;
    if (channelFilter !== 'TODOS' && record.channel !== channelFilter) return false;
    if (!query) return true;

    return (
      (record.clientCode || '').toLowerCase().includes(query)
      || (record.clientName || '').toLowerCase().includes(query)
      || (record.observations || '').toLowerCase().includes(query)
    );
  });
}
