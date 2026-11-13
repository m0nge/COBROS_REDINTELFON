type DatedPromise = {
  id: string;
  country: string;
  clientCode: string;
  createdAt?: string;
  agreementDate?: string;
};

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
