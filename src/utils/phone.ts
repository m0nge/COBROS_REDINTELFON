export function sanitizeTelephoneNumber(value: unknown): string {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  return `${raw.startsWith('+') ? '+' : ''}${digits}`;
}
