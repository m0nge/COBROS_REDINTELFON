import rawClientsSV from '../src/data/realSapClientsSV.json';
import rawClientsGT from '../src/data/realSapClientsGT.json';
import realDebtsSnapshotSV from '../src/data/realDebtsSnapshotSV.json';

const SAP_API_KEY = process.env.SAP_API_KEY || ''; 

function enrichClientWithMora(rawClient: any, _index: number, pais: 'SV' | 'GT') {
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

function isClientActiveRaw(c: any): boolean {
  const statusStr = String(c.estatus || c.status || c.estado || c.Estatus || c.Status || c.Estado || '').trim().toUpperCase();
  if (statusStr) {
    if (
      statusStr.includes('INACT') ||
      statusStr.includes('BAJA') ||
      statusStr.includes('CANCEL') ||
      statusStr.includes('SUSPEND') ||
      statusStr === 'NO ACTIVO' ||
      statusStr === 'NO'
    ) {
      return false;
    }
  }
  const clasifStr = String(c.clasificacion || c.CLASIFICACION || '').trim().toUpperCase();
  if (clasifStr.includes('INACT') || clasifStr.includes('BAJA') || clasifStr.includes('CANCEL')) {
    return false;
  }
  return true;
}

export default async function handler(req: any, res: any) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const queryPais = req.query?.pais || (req.url && req.url.includes('pais=GT') ? 'GT' : 'SV');
  const pais = queryPais === 'GT' ? 'GT' : 'SV';

  try {
    const sapUrl = `https://sapapi.red.com.sv/api/Cliente/clienteasignado?var_pais=${pais}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const sapResponse = await fetch(sapUrl, {
      headers: {
        'X-API-KEY': SAP_API_KEY,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (sapResponse.ok) {
      const rawList = await sapResponse.json();
      if (Array.isArray(rawList) && rawList.length > 0) {
        const activeList = rawList.filter(isClientActiveRaw);
        const clients = activeList.map((c: any, i: number) => enrichClientWithMora(c, i, pais));
        return res.status(200).json({
          success: true,
          count: clients.length,
          pais,
          lastSync: new Date().toISOString(),
          clients,
        });
      }
    }
  } catch (err: any) {
    console.warn(`[Vercel Serverless] SAP fetch failed: ${err.message}`);
  }

  // Guaranteed fallback snapshot
  const fallbackRaw = pais === 'SV' ? rawClientsSV : rawClientsGT;
  const activeFallback = fallbackRaw.filter(isClientActiveRaw);
  const clients = activeFallback.map((c: any, i: number) => enrichClientWithMora(c, i, pais));

  return res.status(200).json({
    success: true,
    count: clients.length,
    pais,
    lastSync: new Date().toISOString(),
    clients,
  });
}
