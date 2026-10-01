// Vercel Serverless Function: Proxy for SAN Cliente 360 & DTE Facturación
const sanCache = new Map<string, { timestamp: number; data: any }>();
const inFlightRequests = new Map<string, Promise<any>>();

async function fetchSanSubEndpoint(endpoint: string, cliente: string, pais: string, timeoutMs = 25000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const uniqid = Date.now().toString();
    const url = `https://san.red.com.sv/consultaIntegral/${endpoint}?cliente=${encodeURIComponent(cliente)}&pais=${pais}&uniqid=${uniqid}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json, text/plain, */*',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const queryCliente = req.query?.cliente || (req.url && new URL(req.url, 'http://localhost').searchParams.get('cliente')) || '';
  const cliente = String(queryCliente).trim();
  const queryPais = req.query?.pais || (req.url && new URL(req.url, 'http://localhost').searchParams.get('pais')) || 'SV';
  const pais = String(queryPais).toUpperCase() === 'GT' ? 'GT' : 'SV';

  if (!cliente) {
    return res.status(400).json({ success: false, error: 'Código de cliente requerido' });
  }

  const cacheKey = `${pais}_${cliente}`;
  const now = Date.now();
  if (sanCache.has(cacheKey)) {
    const cached = sanCache.get(cacheKey)!;
    if (now - cached.timestamp < 15 * 60 * 1000) {
      return res.status(200).json({ success: true, data: cached.data });
    }
  }

  if (inFlightRequests.has(cacheKey)) {
    try {
      const data = await inFlightRequests.get(cacheKey)!;
      return res.status(200).json({ success: true, data });
    } catch {
      // Fall through to retry
    }
  }

  const fetchPromise = (async () => {
    const [infoRaw, anexosRaw, facturasRaw, claimsRaw, pagosRaw, equiposRaw] = await Promise.all([
      fetchSanSubEndpoint('infoClienteSap', cliente, pais, 15000),
      fetchSanSubEndpoint('informacionAnexos.html', cliente, pais, 15000),
      fetchSanSubEndpoint('tablaFacturaR.html', cliente, pais, 35000),
      fetchSanSubEndpoint('tablaServicioR.html', cliente, pais, 15000),
      fetchSanSubEndpoint('pagosCliente', cliente, pais, 15000),
      fetchSanSubEndpoint('equiposUbicacion', cliente, pais, 25000),
    ]);

    const clientInfo = Array.isArray(infoRaw) && infoRaw.length > 0 ? infoRaw[0] : null;
    const anexosData = Array.isArray(anexosRaw) && anexosRaw.length > 0 ? anexosRaw[0] : null;
    const invoices: any[] = Array.isArray(facturasRaw) ? facturasRaw : [];
    const claims: any[] = Array.isArray(claimsRaw) ? claimsRaw : [];
    const payments: any[] = Array.isArray(pagosRaw) ? pagosRaw : [];
    const equipment: any[] = Array.isArray(equiposRaw) ? equiposRaw : [];

    // Calculate invoice totals
    let totalEmitidasMonto = 0;
    let pagadasCount = 0;
    let pagadasMonto = 0;
    let pendientesCount = 0;
    let pendientesMonto = 0;

    const latestEmision = invoices.reduce((max, inv) => {
      const e = (inv.fechaEmision || '').slice(0, 7);
      return e > max ? e : max;
    }, '2026-10');

    let mesEmitidasCount = 0;
    let mesEmitidasMonto = 0;
    let mesPagadasCount = 0;
    let mesPagadasMonto = 0;
    let mesPendientesCount = 0;
    let mesPendientesMonto = 0;

    for (const f of invoices) {
      const val = parseFloat(f.valordoc) || 0;
      totalEmitidasMonto += val;

      const estado = (f.estado || '').toUpperCase();
      const isPagado = estado === 'PAGADO';
      const isPendiente = estado === 'PENDIENTE';

      if (isPagado) {
        pagadasCount++;
        pagadasMonto += val;
      } else if (isPendiente) {
        pendientesCount++;
        pendientesMonto += val;
      } else if (estado === 'PAGO PARCIAL') {
        const pagadoVal = parseFloat(f.pago) || 0;
        const saldoVal = Math.max(0, val - pagadoVal);
        if (saldoVal > 0.01) {
          pagadasCount++;
          pagadasMonto += val;
        }
      }

      const emision = (f.fechaEmision || '').slice(0, 7);
      if (emision === latestEmision || emision === '2026-10') {
        mesEmitidasCount++;
        mesEmitidasMonto += val;
        if (isPagado) {
          mesPagadasCount++;
          mesPagadasMonto += val;
        } else {
          mesPendientesCount++;
          mesPendientesMonto += val;
        }
      }
    }

    const result = {
      clientCode: cliente,
      clientName: clientInfo?.CardName || cliente,
      country: pais,
      clientInfo,
      anexosData,
      invoices,
      claims,
      payments,
      equipment,
      summary: {
        totalEmitidasCount: invoices.length || (pendientesCount > 0 ? 1 : 0),
        totalEmitidasMonto: Math.round(totalEmitidasMonto * 100) / 100,
        pagadasCount,
        pagadasMonto: Math.round(pagadasMonto * 100) / 100,
        pendientesCount,
        pendientesMonto: Math.round(pendientesMonto * 100) / 100,
        mesEmitidasCount,
        mesEmitidasMonto: Math.round(mesEmitidasMonto * 100) / 100,
        mesPagadasCount,
        mesPagadasMonto: Math.round(mesPagadasMonto * 100) / 100,
        mesPendientesCount,
        mesPendientesMonto: Math.round(mesPendientesMonto * 100) / 100,
        claimsCount: claims.length,
      },
    };

    sanCache.set(cacheKey, { timestamp: Date.now(), data: result });
    return result;
  })();

  inFlightRequests.set(cacheKey, fetchPromise);

  try {
    const data = await fetchPromise;
    inFlightRequests.delete(cacheKey);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    inFlightRequests.delete(cacheKey);
    return res.status(500).json({ success: false, error: error.message || 'Error al conectar con SAN' });
  }
}
