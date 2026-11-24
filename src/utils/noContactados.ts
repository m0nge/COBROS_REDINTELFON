import type { Client, Country } from '../types';

export function filterUncontactedClients(
  clients: Client[],
  country: Country,
  successfulContactCodes: ReadonlySet<string>,
  resolvedCodes: ReadonlySet<string>,
  eligibleClientCodes: ReadonlySet<string>,
): Client[] {
  return clients
    .filter((client) => {
      if (client.country !== country) return false;
      const code = client.code.trim().toUpperCase();
      if (
        !code
        || !eligibleClientCodes.has(code)
        || successfulContactCodes.has(code)
        || resolvedCodes.has(code)
        || client.debtVerified === false
        || !Number.isFinite(Number(client.totalDebt))
        || Number(client.totalDebt) <= 0
        || !Number.isFinite(Number(client.daysArrears))
        || Number(client.daysArrears) <= 0
      ) return false;
      if (client.state === 'Resuelto') return false;

      const status = String(client.estatus || client.status || '').toUpperCase();
      if (
        status.includes('INACT')
        || status.includes('BAJA')
        || status.includes('CANCEL')
        || status.includes('SUSPEND')
        || status === 'NO ACTIVO'
      ) {
        return false;
      }
      return true;
    })
    .sort((left, right) => (right.daysArrears || 0) - (left.daysArrears || 0));
}
