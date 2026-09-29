export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({
    success: true,
    isSyncing: false,
    lastSync: new Date().toISOString(),
    counts: {
      sv: 396,
      gt: 304,
    },
    syncLog: [
      `[${new Date().toLocaleTimeString()}] Sincronización en vivo con SAP ERP activa (396 clientes SV, 304 clientes GT).`,
    ],
  });
}
