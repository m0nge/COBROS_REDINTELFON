function isValidDateKey(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function formatDateEntry(value: string): string {
  if (!isValidDateKey(value)) return value;
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export function parseDateEntry(value: string): string | null {
  const trimmed = value.trim();
  if (isValidDateKey(trimmed)) return trimmed;

  const match = trimmed.match(/^(?:(\d{1,2})[./-](\d{1,2})[./-](\d{4})|(\d{2})(\d{2})(\d{4}))$/);
  if (!match) return null;
  const [, separatedDay, separatedMonth, separatedYear, compactDay, compactMonth, compactYear] = match;
  const dayValue = separatedDay || compactDay;
  const monthValue = separatedMonth || compactMonth;
  const yearValue = separatedYear || compactYear;
  if (!dayValue || !monthValue || !yearValue) return null;
  const day = Number(dayValue);
  const month = Number(monthValue);
  const year = Number(yearValue);
  const dateKey = `${yearValue}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidDateKey(dateKey) && month >= 1 && month <= 12 ? dateKey : null;
}

export function dateEntryRangeError(dateKey: string, min?: string, max?: string): string {
  if (min && dateKey < min) return `La fecha no puede ser anterior a ${formatDateEntry(min)}.`;
  if (max && dateKey > max) return `La fecha no puede ser posterior a ${formatDateEntry(max)}.`;
  return '';
}
