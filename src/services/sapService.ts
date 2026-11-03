import { Client, Country } from '../types';
import { authenticatedApiFetch } from './authService';

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function enrichClientWithMora(rawClient: any, _index: number, country: Country): Client {
  const code = String(rawClient?.code || rawClient?.Codigo || rawClient?.codigo || '');
  const totalDebt = numberOrNull(rawClient?.totalDebt ?? rawClient?.total_debt);
  const debtVerified = totalDebt !== null;
  const daysArrears = numberOrNull(rawClient?.daysArrears ?? rawClient?.days_arrears);
  const safeDaysArrears = debtVerified ? daysArrears ?? 0 : 0;
  const moraRange = debtVerified
    ? rawClient?.moraRange
      || (safeDaysArrears <= 30 ? '0-30'
        : safeDaysArrears <= 60 ? '31-60'
          : safeDaysArrears <= 90 ? '61-90'
            : safeDaysArrears <= 120 ? '91-120' : '120+')
    : '0-30';

  return {
    code,
    name: String(rawClient?.name || rawClient?.Nombre || rawClient?.nombre || ''),
    address: String(rawClient?.address || rawClient?.direccion || ''),
    phone1: String(rawClient?.phone1 || ''),
    phone2: String(rawClient?.phone2 || ''),
    cell: String(rawClient?.celular || rawClient?.cell || ''),
    celular: String(rawClient?.celular || rawClient?.cell || ''),
    department: String(rawClient?.departamento || ''),
    municipality: String(rawClient?.municipio || ''),
    email: String(rawClient?.correo || rawClient?.email || ''),
    classification: String(rawClient?.clasificacion || ''),
    salesManager: String(rawClient?.gestorcomercial || rawClient?.salesManager || ''),
    managerEmail: String(rawClient?.emailgestor || rawClient?.managerEmail || ''),
    managerCode: String(rawClient?.codigogestor || rawClient?.managerCode || ''),
    country,
    totalDebt: debtVerified ? Math.round(totalDebt! * 100) / 100 : 0,
    debtVerified,
    daysArrears: safeDaysArrears,
    moraRange,
    state: debtVerified ? rawClient?.state || (totalDebt === 0 ? 'Resuelto' : 'Pendiente') : 'Pendiente',
    priority: debtVerified
      ? rawClient?.priority || (safeDaysArrears > 90 ? 'Alta' : safeDaysArrears > 30 ? 'Media' : 'Normal')
      : 'Normal',
    lastManagementDate: String(rawClient?.lastManagementDate || ''),
    lastManagementType: String(rawClient?.lastManagementType || ''),
    status: String(rawClient?.status || rawClient?.estatus || 'Activo'),
    estatus: String(rawClient?.estatus || rawClient?.status || 'Activo'),
    invoiceDate: String(rawClient?.invoiceDate || ''),
    dueDate: String(rawClient?.dueDate || ''),
    assignedAgentId: rawClient?.assignedAgentId || undefined,
    assignedAgentName: rawClient?.assignedAgentName || undefined,
    isManualAssignment: Boolean(rawClient?.isManualAssignment),
    isFixedAssignment: Boolean(rawClient?.isFixedAssignment),
  };
}

/**
 * Load only the authenticated user's market and, for agents, only clients from
 * their fixed assignment. There is intentionally no client-side cross-country
 * snapshot or fallback when SAP/authentication is unavailable.
 */
export async function fetchCarteraClients(country: Country): Promise<{ clients: Client[]; source: string; timestamp: string }> {
  const response = await authenticatedApiFetch(`/api/cartera?pais=${encodeURIComponent(country)}`, {
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success || !Array.isArray(payload.clients)) {
    throw new Error(payload?.error || 'CARTERA_UNAVAILABLE');
  }

  return {
    clients: payload.clients.map((client: any, index: number) => enrichClientWithMora(client, index, country)),
    source: 'SAP autenticado',
    timestamp: String(payload.lastSync || new Date().toISOString()),
  };
}
