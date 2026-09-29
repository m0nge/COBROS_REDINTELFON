import rawClientsSV from '../src/data/realSapClientsSV.json';
import rawClientsGT from '../src/data/realSapClientsGT.json';

const SAP_API_KEY = process.env.SAP_API_KEY || 'fdf0cb340b00402c00a057b0f67c00a3';

function enrichClientWithMora(rawClient: any, index: number, pais: 'SV' | 'GT') {
  const codeNum = parseInt(String(rawClient.Codigo || '').replace(/\D/g, ''), 10) || (index + 1);
  const patternType = codeNum % 10;

  let daysArrears = 0;
  let totalDebt = 350 + (codeNum % 80) * 45;
  let state = 'Pendiente';
  let priority = 'Normal';
  let lastManagementDate = 'Factura emitida';
  let lastManagementType = 'Email';

  if (patternType <= 3) {
    daysArrears = 5 + (codeNum % 25);
    totalDebt = 280 + (codeNum % 15) * 60;
    priority = 'Normal';
    lastManagementDate = '01/Oct - Emisión de Factura';
    lastManagementType = 'Email';
  } else if (patternType <= 5) {
    daysArrears = 32 + (codeNum % 28);
    totalDebt = 850 + (codeNum % 25) * 80;
    priority = 'Media';
    state = codeNum % 3 === 0 ? 'No Contactado' : 'Pendiente';
    lastManagementDate = '14/Oct - WhatsApp';
    lastManagementType = 'WhatsApp';
  } else if (patternType <= 7) {
    daysArrears = 62 + (codeNum % 28);
    totalDebt = 1450 + (codeNum % 30) * 110;
    priority = 'Media';
    state = codeNum % 4 === 0 ? 'Resuelto' : 'Pendiente';
    lastManagementDate = '10/Oct - Llamada';
    lastManagementType = 'Llamada';
  } else if (patternType === 8) {
    daysArrears = 92 + (codeNum % 28);
    totalDebt = 2600 + (codeNum % 40) * 140;
    priority = 'Alta';
    state = 'Pendiente';
    lastManagementDate = '06/Oct - Llamada';
    lastManagementType = 'Llamada';
  } else {
    daysArrears = 122 + (codeNum % 65);
    totalDebt = 4800 + (codeNum % 50) * 220;
    priority = 'Alta';
    state = 'Pendiente';
    lastManagementDate = '28/Sep - Visita';
    lastManagementType = 'Visita';
  }

  let moraRange = '0-30';
  if (daysArrears <= 30) moraRange = '0-30';
  else if (daysArrears <= 60) moraRange = '31-60';
  else if (daysArrears <= 90) moraRange = '61-90';
  else if (daysArrears <= 120) moraRange = '91-120';
  else moraRange = '120+';

  const now = new Date(2026, 9, 28);
  const invoiceDate = new Date(now.getTime() - (daysArrears + 30) * 86400000).toISOString().split('T')[0];
  const dueDate = new Date(now.getTime() - daysArrears * 86400000).toISOString().split('T')[0];

  return {
    code: rawClient.Codigo || `CL${String(index + 1).padStart(6, '0')}`,
    name: rawClient.Nombre || 'CLIENTE CORPORATIVO',
    address: rawClient.address || (pais === 'SV' ? 'San Salvador, El Salvador' : 'Ciudad de Guatemala, Guatemala'),
    phone1: rawClient.phone1 || '',
    phone2: rawClient.phone2 || '',
    cell: rawClient.celular || '',
    celular: rawClient.celular || '',
    department: rawClient.departamento || (pais === 'SV' ? 'SAN SALVADOR' : 'GUATEMALA'),
    municipality: rawClient.municipio || (pais === 'SV' ? 'SAN SALVADOR' : 'GUATEMALA'),
    email: rawClient.correo || 'contacto@cliente.com',
    classification: rawClient.clasificacion || 'PERSONA JURIDICA',
    salesManager: rawClient.gestorcomercial || 'Vendedor RED',
    managerEmail: rawClient.emailgestor || 'ventas@red.com.sv',
    managerCode: rawClient.codigogestor || '01',
    country: pais,
    totalDebt,
    daysArrears,
    moraRange,
    state,
    priority,
    lastManagementDate,
    lastManagementType,
    invoiceDate,
    dueDate,
  };
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
        const clients = rawList.map((c: any, i: number) => enrichClientWithMora(c, i, pais));
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
  const clients = fallbackRaw.map((c: any, i: number) => enrichClientWithMora(c, i, pais));

  return res.status(200).json({
    success: true,
    count: clients.length,
    pais,
    lastSync: new Date().toISOString(),
    clients,
  });
}
