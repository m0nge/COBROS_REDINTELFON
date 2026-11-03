// Vercel Serverless Function: Proxy for SAN Cliente 360 & DTE Facturación
import {
  assertAgentClientAccess,
  authenticateAgentRequest,
  respondAuthError,
} from '../server/supabaseAuth.js';

const sanCache = new Map<string, { timestamp: number; data: any }>();
const inFlightRequests = new Map<string, Promise<any>>();
const sanApiKey = String(process.env.SAN_API_KEY || '').trim();

type SanFetchResult =
  | { ok: true; data: any }
  | { ok: false; error: string };

async function fetchSanSubEndpoint(endpoint: string, cliente: string, pais: string, timeoutMs = 25000) {
  if (!sanApiKey) {
    return { ok: false, error: 'Falta configurar SAN_API_KEY en las variables de Vercel para Production.' } satisfies SanFetchResult;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const uniqid = Date.now().toString();
    const url = `https://san.red.com.sv/consultaIntegral/${endpoint}?cliente=${encodeURIComponent(cliente)}&pais=${pais}&uniqid=${uniqid}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json, text/plain, */*',
        'X-API-KEY': sanApiKey,
      },
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { ok: false, error: `SAN respondió HTTP ${resp.status} en ${endpoint}.` } satisfies SanFetchResult;
    }
    try {
      return { ok: true, data: await resp.json() } satisfies SanFetchResult;
    } catch {
      return { ok: false, error: `SAN devolvió una respuesta que no es JSON en ${endpoint}.` } satisfies SanFetchResult;
    }
  } catch (error: any) {
    const detail = controller.signal.aborted
      ? 'se agotó el tiempo de espera'
      : 'falló la conexión';
    return { ok: false, error: `SAN ${detail} en ${endpoint}${error?.cause?.code ? ` (${error.cause.code})` : ''}.` } satisfies SanFetchResult;
  } finally {
    clearTimeout(timeout);
  }
}

function parseSanAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? '').trim().replace(/,/g, '');
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeSanInvoiceStatus(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function isVoidedSanInvoiceStatus(status: string): boolean {
  return ['ANULADO', 'ANULADA', 'CANCELADO', 'CANCELADA'].includes(status);
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  let context;
  try {
    context = await authenticateAgentRequest(req);
  } catch (error) {
    return respondAuthError(res, error);
  }

  const queryCliente = req.query?.cliente || (req.url && new URL(req.url, 'http://localhost').searchParams.get('cliente')) || '';
  const cliente = String(queryCliente).trim();
  const queryPais = req.query?.pais || (req.url && new URL(req.url, 'http://localhost').searchParams.get('pais')) || context.agent.pais;
  const pais = String(queryPais).toUpperCase();
  const queryRefresh = req.query?.refresh
    || (req.url && new URL(req.url, 'http://localhost').searchParams.get('refresh'))
    || '';
  const forceRefresh = ['1', 'true', 'yes'].includes(String(queryRefresh).toLowerCase());

  if (!cliente) {
    return res.status(400).json({ success: false, error: 'Código de cliente requerido' });
  }
  if (pais !== 'SV' && pais !== 'GT') {
    return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
  }
  try {
    await assertAgentClientAccess(context, pais, cliente);
  } catch (error) {
    return respondAuthError(res, error);
  }

  const cacheKey = `${pais}_${cliente}`;
  const now = Date.now();
  if (!forceRefresh && sanCache.has(cacheKey)) {
    const cached = sanCache.get(cacheKey)!;
    if (now - cached.timestamp < 15 * 60 * 1000) {
      return res.status(200).json({ success: true, data: cached.data });
    }
  }

  if (!forceRefresh && inFlightRequests.has(cacheKey)) {
    try {
      const data = await inFlightRequests.get(cacheKey)!;
      return res.status(200).json({ success: true, data });
    } catch {
      // Fall through to retry
    }
  }

  const fetchPromise = (async () => {
    const [infoResult, anexosResult, facturasResult, claimsResult, pagosResult, equiposResult] = await Promise.all([
      fetchSanSubEndpoint('infoClienteSap', cliente, pais, 15000),
      fetchSanSubEndpoint('informacionAnexos.html', cliente, pais, 15000),
      fetchSanSubEndpoint('tablaFacturaR.html', cliente, pais, 35000),
      fetchSanSubEndpoint('tablaServicioR.html', cliente, pais, 15000),
      fetchSanSubEndpoint('pagosCliente', cliente, pais, 15000),
      fetchSanSubEndpoint('equiposUbicacion', cliente, pais, 25000),
    ]);

    if (!facturasResult.ok) {
      throw new Error(facturasResult.error);
    }
    const endpointResults = [
      ['infoClienteSap', infoResult],
      ['informacionAnexos.html', anexosResult],
      ['tablaFacturaR.html', facturasResult],
      ['tablaServicioR.html', claimsResult],
      ['pagosCliente', pagosResult],
      ['equiposUbicacion', equiposResult],
    ] as const;
    const endpointWarnings = endpointResults
      .filter(([, result]) => !result.ok)
      .map(([, result]) => result.error);
    const infoRaw = infoResult.ok ? infoResult.data : null;
    const anexosRaw = anexosResult.ok ? anexosResult.data : null;
    const facturasRaw = facturasResult.data;
    const claimsRaw = claimsResult.ok ? claimsResult.data : null;
    const pagosRaw = pagosResult.ok ? pagosResult.data : null;
    const equiposRaw = equiposResult.ok ? equiposResult.data : null;

    const clientInfo = Array.isArray(infoRaw) && infoRaw.length > 0 ? infoRaw[0] : null;
    const anexosData = Array.isArray(anexosRaw) && anexosRaw.length > 0 ? anexosRaw[0] : null;
    const invoiceDataAvailable = Array.isArray(facturasRaw);
    if (!invoiceDataAvailable) {
      throw new Error('SAN respondió, pero el detalle de facturas no tiene el formato esperado.');
    }
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
    let totalEmitidasCount = 0;

    let invoiceBalancesComplete: boolean = invoiceDataAvailable;
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
      const estado = normalizeSanInvoiceStatus(f.estado);
      if (isVoidedSanInvoiceStatus(estado)) continue;

      totalEmitidasCount++;
      const val = parseSanAmount(f.valordoc);
      let saldoPendiente: number | null = null;

      if (val === null) {
        invoiceBalancesComplete = false;
      } else {
        totalEmitidasMonto += val;
      }

      if (estado === 'PAGADO' || estado === 'PAGADA') {
        saldoPendiente = 0;
        pagadasCount++;
        pagadasMonto += val ?? 0;
      } else if (estado.startsWith('PENDIENTE') && val !== null) {
        saldoPendiente = val;
      } else if (estado.startsWith('PAGO PARCIAL') && val !== null) {
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
      endpointWarnings,
      summary: {
        totalEmitidasCount,
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
    if (inFlightRequests.get(cacheKey) === fetchPromise) inFlightRequests.delete(cacheKey);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (inFlightRequests.get(cacheKey) === fetchPromise) inFlightRequests.delete(cacheKey);
    return res.status(502).json({ success: false, error: error.message || 'Error al conectar con SAN.' });
  }
}
