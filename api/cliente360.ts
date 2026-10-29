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

function parseSanAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? '').trim().replace(/,/g, '');
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
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
    const invoiceDataAvailable = Array.isArray(facturasRaw);
    const invoices: any[] = invoiceDataAvailable ? facturasRaw : [];
    const claims: any[] = Array.isArray(claimsRaw) ? claimsRaw : [];
    const payments: any[] = Array.isArray(pagosRaw) ? pagosRaw : [];
    const equipment: any[] = Array.isArray(equiposRaw) ? equiposRaw : [];

    // Calculate invoice totals
    let totalEmitidasMonto = 0;
    let pagadasCount = 0;
    let pagadasMonto = 0;
    let pendientesCount = 0;
    let pendientesMonto = 0;

    let invoiceBalancesComplete = invoiceDataAvailable;
    const currentMonthParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/El_Salvador',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    const currentMonth =
      `${currentMonthParts.find((part) => part.type === 'year')?.value}-` +
      `${currentMonthParts.find((part) => part.type === 'month')?.value}`;

    let mesEmitidasCount = 0;
    let mesEmitidasMonto = 0;
    let mesPagadasCount = 0;
    let mesPagadasMonto = 0;
    let mesPendientesCount = 0;
    let mesPendientesMonto = 0;

    for (const f of invoices) {
      const val = parseSanAmount(f.valordoc);
      const estado = String(f.estado || '').trim().toUpperCase();
      let saldoPendiente: number | null = null;

      if (val === null) {
        invoiceBalancesComplete = false;
      } else {
        totalEmitidasMonto += val;
      }

      if (estado === 'PAGADO') {
        saldoPendiente = 0;
        pagadasCount++;
        pagadasMonto += val ?? 0;
      } else if (estado === 'PENDIENTE' && val !== null) {
        saldoPendiente = val;
      } else if (estado === 'PAGO PARCIAL' && val !== null) {
        const pagado = parseSanAmount(f.pago);
        if (pagado === null) {
          invoiceBalancesComplete = false;
        } else {
          saldoPendiente = Math.max(0, val - pagado);
          if (saldoPendiente <= 0.01) {
            pagadasCount++;
            pagadasMonto += val;
          }
        }
      } else {
        invoiceBalancesComplete = false;
      }

      if (saldoPendiente !== null && saldoPendiente > 0.01) {
        pendientesCount++;
        pendientesMonto += saldoPendiente;
      }

      const emision = (f.fechaEmision || '').slice(0, 7);
      if (emision === currentMonth) {
        mesEmitidasCount++;
        mesEmitidasMonto += val ?? 0;
        if (saldoPendiente !== null && saldoPendiente <= 0.01) {
          mesPagadasCount++;
          mesPagadasMonto += val ?? 0;
        } else if (saldoPendiente !== null) {
          mesPendientesCount++;
          mesPendientesMonto += saldoPendiente;
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
      invoiceDataAvailable,
      invoiceBalancesComplete,
      claims,
      payments,
      equipment,
      summary: {
        totalEmitidasCount: invoices.length,
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
