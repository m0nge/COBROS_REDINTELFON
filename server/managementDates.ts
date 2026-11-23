export function getElSalvadorDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : '';
}

export function isNewDateWithinCurrentManagementMonth(
  managementDate: string,
  targetDate: string,
  today: string,
  unchangedExistingDate = '',
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return false;
  if (targetDate === unchangedExistingDate) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(managementDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(today)
    && managementDate.slice(0, 7) === today.slice(0, 7)
    && targetDate.slice(0, 7) === managementDate.slice(0, 7)
    && targetDate >= today;
}
