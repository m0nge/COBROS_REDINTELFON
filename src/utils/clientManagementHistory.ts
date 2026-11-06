import type { Country, GestionAuditRecord } from '../types';

export function sortClientManagementHistory(
  records: GestionAuditRecord[],
  country: Country,
  clientCode: string,
): GestionAuditRecord[] {
  const normalizedCode = clientCode.trim().toUpperCase();
  return records
    .filter((record) =>
      record.country === country
      && record.clientCode.trim().toUpperCase() === normalizedCode
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.timestamp || '') || 0;
      const rightTime = Date.parse(right.timestamp || '') || 0;
      return rightTime - leftTime || right.id.localeCompare(left.id);
    });
}
