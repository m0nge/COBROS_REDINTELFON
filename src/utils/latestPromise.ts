type DatedPromise = {
  id: string;
  country: string;
  clientCode: string;
  createdAt?: string;
  agreementDate?: string;
};

export type PromiseDisplayStatus = 'Cumplido' | 'Vencido' | 'Pendiente';

export function filterAgreementsByVerifiedEligibility<T extends {
  clientCode: string;
  status: string;
}>(
  agreements: T[],
  eligibleClientCodes: Iterable<string> | null,
): T[] {
  const eligibleCodes = eligibleClientCodes
    ? new Set([...eligibleClientCodes].map((code) => code.trim().toUpperCase()))
    : new Set<string>();
  return agreements.filter((agreement) =>
    agreement.status === 'Cumplido'
    || eligibleCodes.has(agreement.clientCode.trim().toUpperCase()),
  );
}

export function getPromiseDisplayStatus(
  verificationStatus: 'paid' | 'unpaid' | 'unknown' | undefined,
  promiseDate: string,
  todayKey: string,
  monthlyResolved: boolean,
): PromiseDisplayStatus {
  if (verificationStatus === 'paid' || monthlyResolved) return 'Cumplido';
  if (verificationStatus === 'unpaid' && promiseDate < todayKey) return 'Vencido';
  return 'Pendiente';
}

export function isResolvedInOrAfterPromiseMonth(
  resolvedKeys: Iterable<string>,
  country: string,
  clientCode: string,
  promiseMonth: string,
): boolean {
  const normalizedCode = clientCode.trim().toUpperCase();
  return [...resolvedKeys].some((key) => {
    const [resolvedCountry, resolvedCode, resolvedMonth] = key.split(':');
    return resolvedCountry === country
      && resolvedCode.trim().toUpperCase() === normalizedCode
      && /^\d{4}-\d{2}$/.test(resolvedMonth)
      && resolvedMonth >= promiseMonth;
  });
}

function createdTime(record: DatedPromise): number {
  return Date.parse(record.createdAt || record.agreementDate || '') || 0;
}

export function latestPromisePerClient<T extends DatedPromise>(records: T[]): T[] {
  const latest = new Map<string, T>();
  for (const record of records) {
    const key = `${record.country}:${record.clientCode.trim().toUpperCase()}`;
    const existing = latest.get(key);
    if (
      !existing
      || createdTime(record) > createdTime(existing)
      || (createdTime(record) === createdTime(existing) && record.id > existing.id)
    ) {
      latest.set(key, record);
    }
  }
  return [...latest.values()].sort((left, right) =>
    createdTime(right) - createdTime(left) || right.id.localeCompare(left.id)
  );
}
