import { Client, Country } from '../types';
import rawClientsSV from '../data/realSapClientsSV.json';
import rawClientsGT from '../data/realSapClientsGT.json';
import realDebtsSnapshotSV from '../data/realDebtsSnapshotSV.json';


export function enrichClientWithMora(rawClient: any, _index: number, pais: Country): Client {
  const clientCode = String(rawClient?.Codigo || '');
  const realSnap = (realDebtsSnapshotSV as Record<string, any>)[clientCode];
  const rawDebt = rawClient?.totalDebt;
  const snapshotDebt = realSnap?.totalDebt;
  const verifiedDebt = rawDebt !== undefined && rawDebt !== null ? Number(rawDebt) : snapshotDebt !== undefined && snapshotDebt !== null ? Number(snapshotDebt) : null;
  const debtVerified = verifiedDebt !== null && Number.isFinite(verifiedDebt);
  const daysArrears = debtVerified ? Number(rawClient?.daysArrears ?? realSnap?.daysArrears ?? 0) : 0;
  const moraRange = debtVerified ? rawClient?.moraRange || realSnap?.moraRange || (daysArrears <= 30 ? '0-30' : daysArrears <= 60 ? '31-60' : daysArrears <= 90 ? '61-90' : daysArrears <= 120 ? '91-120' : '120+') : '0-30';
  return {
    code: clientCode, name: String(rawClient?.Nombre || ''), address: String(rawClient?.address || ''),
    phone1: String(rawClient?.phone1 || ''), phone2: String(rawClient?.phone2 || ''),
    cell: String(rawClient?.celular || ''), celular: String(rawClient?.celular || ''),
    department: String(rawClient?.departamento || ''), municipality: String(rawClient?.municipio || ''),
    email: String(rawClient?.correo || ''), classification: String(rawClient?.clasificacion || ''),
    salesManager: String(rawClient?.gestorcomercial || ''), managerEmail: String(rawClient?.emailgestor || ''),
    managerCode: String(rawClient?.codigogestor || ''), country: pais,
    totalDebt: debtVerified ? Math.round(verifiedDebt! * 100) / 100 : 0, debtVerified, daysArrears, moraRange,
    state: debtVerified ? rawClient?.state || (verifiedDebt === 0 ? 'Resuelto' : 'Pendiente') : 'Pendiente',
    priority: debtVerified ? rawClient?.priority || realSnap?.priority || (daysArrears > 90 ? 'Alta' : daysArrears > 30 ? 'Media' : 'Normal') : 'Normal',
    lastManagementDate: String(rawClient?.lastManagementDate || ''), lastManagementType: String(rawClient?.lastManagementType || ''),
    status: 'Activo', estatus: 'Activo',
    invoiceDate: debtVerified ? String(rawClient?.invoiceDate || realSnap?.invoiceDate || '') : '',
    dueDate: debtVerified ? String(rawClient?.dueDate || realSnap?.dueDate || '') : '',
  };
}

function isClientActive(c: any): boolean {
  const s = String(c.estatus || c.status || c.estado || c.Estatus || c.Status || '').trim().toUpperCase();
  if (s.includes('INACT') || s.includes('BAJA') || s.includes('CANCEL') || s.includes('SUSPEND') || s === 'NO ACTIVO') {
    return false;
  }
  const clasif = String(c.clasificacion || c.CLASIFICACION || '').trim().toUpperCase();
  if (clasif.includes('INACT') || clasif.includes('BAJA') || clasif.includes('CANCEL')) {
    return false;
  }
  return true;
}

export function getFallbackSapClients(pais: Country): Client[] {
  const rawList = pais === 'SV' ? rawClientsSV : rawClientsGT;
  return rawList.filter(isClientActive).map((c, i) => enrichClientWithMora(c, i, pais));
}

/**
 * Robust Client Retrieval Strategy:
 * 1. Try local/serverless proxy `/api/cartera?pais=...`
 * 2. If proxy returns error or fails, try Direct Fetch to SAP API (CORS enabled)
 * 3. Fallback seamlessly to the verified real SAP portfolio snapshot (396 SV, 304 GT)
 */
export async function fetchCarteraClients(pais: Country): Promise<{ clients: Client[]; source: string; timestamp: string }> {
  // Strategy 1: Try backend /api/cartera
  try {
    const res = await fetch(`/api/cartera?pais=${pais}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.clients) && data.clients.length > 0) {
        const trustedClients = getFallbackSapClients(pais);
        const assignmentsByCode = new Map(
          data.clients.map((client: any) => [
            String(client.code || client.Codigo || '').toUpperCase(),
            client,
          ])
        );
        const safeClients = trustedClients.map((client) => {
          const backendClient = assignmentsByCode.get(String(client.code || '').toUpperCase()) as any;
          return {
            ...client,
            ...(backendClient
              ? {
                  assignedAgentId: backendClient.assignedAgentId,
                  assignedAgentName: backendClient.assignedAgentName,
                  isManualAssignment: backendClient.isManualAssignment,
                }
              : {}),
          };
        });
        return {
          clients: safeClients,
          source: 'Snapshot SAP local validado; asignaciones del backend',
          timestamp: data.lastSync || new Date().toISOString(),
        };
      }
    }
  } catch (e) {
    console.warn('[Cartera] Backend endpoint not responding, trying direct SAP API...');
  }

  // Direct browser SAP calls disabled; credentials remain server-side.

  // Strategy 3: Real SAP Snapshot (396 SV, 304 GT)
  const bundled = getFallbackSapClients(pais);
  return {
    clients: bundled,
    source: 'snapshot-cache',
    timestamp: new Date().toISOString(),
  };
}
