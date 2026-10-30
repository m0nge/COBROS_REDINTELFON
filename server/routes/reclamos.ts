import {
  authenticateAgentRequest,
  respondAuthError,
} from '../supabaseAuth.js';

// Use the full cases feed; /reclamos/sla omits cases without SLA breaches.
const API_URL = 'https://sac.red.com.sv/api/external/casos';
const PAGE_SIZE = 500;
const MAX_PAGES = 100;
const CASE_CACHE_TTL_MS = 60_000;

type Country = 'SV' | 'GT';
type Reclamo = {
  case_id?: string | number;
  cliente_id?: string;
  cliente_nombre?: string;
  pais?: string;
  estado?: string;
  asunto?: string | null;
  descripcion?: string | null;
  resolucion?: string | null;
  solucion?: string | null;
  fecha_creacion?: string;
  fecha_actualizacion?: string;
  fecha_fin_resolucion?: string | null;
  historial?: Array<Record<string, unknown>>;
  agente?: { nombre?: string; email?: string } | null;
  cliente?: { cliente_id?: string; CardCode?: string; nombre?: string; CardName?: string } | null;
  categoria?: { nombre?: string; categoria?: string; name?: string; label?: string } | string | null;
  [key: string]: unknown;
};

const casesByCountry = new Map<Country, { cachedAt: number; cases: Reclamo[] }>();
const casesInFlight = new Map<Country, Promise<Reclamo[]>>();

function queryValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function normalize(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es');
}

function normalizeClientCode(value: unknown): string {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function normalizeClientName(value: unknown): string {
  return normalize(value).replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function normalizeCountry(value: unknown): Country | null {
  const country = normalize(value).replace(/[\s_-]+/g, '');
  if (country === 'sv' || country === 'elsalvador') return 'SV';
  if (country === 'gt' || country === 'guatemala') return 'GT';
  return null;
}

function extractCases(payload: unknown): Reclamo[] {
  if (Array.isArray(payload)) return payload as Reclamo[];
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  for (const key of ['casos', 'reclamos', 'cases', 'data', 'results', 'items']) {
    if (Array.isArray(record[key])) return record[key] as Reclamo[];
    if (record[key] && typeof record[key] === 'object') {
      const nested = extractCases(record[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}

function hasCasesCollection(payload: unknown): boolean {
  if (Array.isArray(payload)) return true;
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  for (const key of ['casos', 'reclamos', 'cases', 'data', 'results', 'items']) {
    if (Array.isArray(record[key])) return true;
    if (record[key] && typeof record[key] === 'object' && hasCasesCollection(record[key])) return true;
  }
  return false;
}

function isClosed(status: unknown): boolean {
  return ['finalizado', 'finalizada', 'cerrado', 'cerrada', 'resuelto', 'resuelta'].includes(normalize(status));
}

function getTimestamp(caseRecord: Reclamo): number {
  const date = Date.parse(String(caseRecord.fecha_actualizacion || caseRecord.fecha_creacion || ''));
  return Number.isNaN(date) ? 0 : date;
}

function getClientCode(caseRecord: Reclamo): string {
  return String(caseRecord.cliente_id || caseRecord.cliente?.cliente_id || caseRecord.cliente?.CardCode || '');
}

function getClientName(caseRecord: Reclamo): string {
  return String(caseRecord.cliente_nombre || caseRecord.cliente?.nombre || caseRecord.cliente?.CardName || '');
}

function textValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, 4000) : null;
}

function getCaseType(caseRecord: Reclamo): string | null {
  const typeKeys = new Set([
    'tipo', 'tipocaso', 'tiporeclamo', 'tiposolicitud', 'type', 'casetype', 'claimtype',
  ]);
  for (const [key, value] of Object.entries(caseRecord)) {
    if (!typeKeys.has(normalize(key).replace(/[^a-z0-9]/g, ''))) continue;
    const directText = textValue(value);
    if (directText) return directText;
    if (value && typeof value === 'object') {
      const type = value as Record<string, unknown>;
      for (const detailKey of ['nombre', 'name', 'label', 'descripcion']) {
        const nestedText = textValue(type[detailKey]);
        if (nestedText) return nestedText;
      }
    }
  }
  return null;
}

function getResolutionText(caseRecord: Reclamo): string | null {
  const resolutionKeys = new Set([
    'resolucion', 'resoluciontexto', 'detalleresolucion', 'resumenresolucion',
    'solucion', 'solution', 'resolution', 'resolutiontext', 'resolutiondetails', 'resultadofinal',
  ]);

  for (const [key, value] of Object.entries(caseRecord)) {
    const normalizedKey = normalize(key).replace(/[^a-z0-9]/g, '');
    if (!resolutionKeys.has(normalizedKey)) continue;
    const directText = textValue(value);
    if (directText) return directText;
    if (value && typeof value === 'object') {
      const resolution = value as Record<string, unknown>;
      for (const detailKey of ['detalle', 'descripcion', 'texto', 'text', 'nombre']) {
        const nestedText = textValue(resolution[detailKey]);
        if (nestedText) return nestedText;
      }
    }
  }

  if (!isClosed(caseRecord.estado) || !Array.isArray(caseRecord.historial)) return null;
  const finalHistory = caseRecord.historial
    .filter((entry) => isClosed(entry.estado_nuevo))
    .sort((left, right) => {
      const leftDate = Date.parse(String(left.fechayhora || ''));
      const rightDate = Date.parse(String(right.fechayhora || ''));
      return (Number.isNaN(rightDate) ? 0 : rightDate) - (Number.isNaN(leftDate) ? 0 : leftDate);
    });
  return textValue(finalHistory[0]?.detalle);
}

function publicCase(caseRecord: Reclamo, country: Country): Reclamo {
  const category = typeof caseRecord.categoria === 'string'
    ? caseRecord.categoria
    : caseRecord.categoria?.nombre
      || caseRecord.categoria?.categoria
      || caseRecord.categoria?.name
      || caseRecord.categoria?.label;
  return {
    case_id: caseRecord.case_id,
    cliente_id: getClientCode(caseRecord),
    pais: normalizeCountry(caseRecord.pais) || country,
    estado: caseRecord.estado,
    tipo: getCaseType(caseRecord),
    asunto: textValue(caseRecord.asunto),
    descripcion: textValue(caseRecord.descripcion),
    resolucion: getResolutionText(caseRecord),
    fecha_creacion: caseRecord.fecha_creacion,
    fecha_actualizacion: caseRecord.fecha_actualizacion,
    fecha_fin_resolucion: caseRecord.fecha_fin_resolucion,
    agente: caseRecord.agente
      ? { nombre: caseRecord.agente.nombre }
      : null,
    cliente: caseRecord.cliente
      ? { cliente_id: getClientCode(caseRecord), nombre: getClientName(caseRecord) }
      : null,
    categoria: category || null,
  };
}

async function fetchCases(country: Country, apiKey: string): Promise<Reclamo[]> {
  const cached = casesByCountry.get(country);
  if (cached && Date.now() - cached.cachedAt < CASE_CACHE_TTL_MS) return cached.cases;

  const inFlight = casesInFlight.get(country);
  if (inFlight) return inFlight;

  const request = (async () => {
    const allCases: Reclamo[] = [];
    let expectedTotal: number | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(API_URL);
      url.searchParams.set('pais', country);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('offset', String(page * PAGE_SIZE));

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-API-KEY': apiKey,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('RECLAMOS_UPSTREAM_ERROR');
      const payload: unknown = await response.json();
      if (!hasCasesCollection(payload)) throw new Error('RECLAMOS_UPSTREAM_UNEXPECTED_SHAPE');
      const pageCases = extractCases(payload);
      allCases.push(...pageCases);
      if (payload && typeof payload === 'object') {
        const metadata = (payload as Record<string, unknown>).metadata;
        if (metadata && typeof metadata === 'object') {
          const total = Number((metadata as Record<string, unknown>).total);
          if (Number.isFinite(total) && total >= 0) expectedTotal = total;
        }
      }
      if (
        pageCases.length < PAGE_SIZE ||
        (expectedTotal !== null && allCases.length >= expectedTotal)
      ) {
        casesByCountry.set(country, { cachedAt: Date.now(), cases: allCases });
        return allCases;
      }
    }
    throw new Error('RECLAMOS_RESULT_TOO_LARGE');
  })();
  casesInFlight.set(country, request);
  try {
    return await request;
  } finally {
    if (casesInFlight.get(country) === request) casesInFlight.delete(country);
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  let agent: Awaited<ReturnType<typeof authenticateAgentRequest>>['agent'];
  try {
    ({ agent } = await authenticateAgentRequest(req));
  } catch (error) {
    return respondAuthError(res, error);
  }

  const country = normalizeCountry(queryValue(req.query?.pais) || agent.pais);
  const clientCode = queryValue(req.query?.clienteCodigo).trim();
  const normalizedClientCode = normalizeClientCode(clientCode);
  const normalizedClientName = normalizeClientName(queryValue(req.query?.clienteNombre));
  if (!country) {
    return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
  }
  if (agent.rol !== 'admin' && country !== agent.pais) {
    return res.status(403).json({ success: false, error: 'COUNTRY_ACCESS_DENIED' });
  }
  if (!clientCode && !normalizedClientName) {
    return res.status(400).json({ success: false, error: 'CLIENT_REQUIRED' });
  }

  const apiKey = process.env.RECLAMOS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'RECLAMOS_API_NOT_CONFIGURED' });
  }

  try {
    const allCases = await fetchCases(country, apiKey);
    const sameCountry = allCases.filter((caseRecord) => {
      const caseCountry = normalizeCountry(caseRecord.pais);
      // The SAC request is already scoped by country; keep records whose own
      // payload omits pais, but never leak records explicitly tagged elsewhere.
      return caseCountry === null || caseCountry === country;
    });
    const casesWithClient = sameCountry.filter((caseRecord) =>
      Boolean(getClientCode(caseRecord) || getClientName(caseRecord))
    );
    const casesWithClientCode = sameCountry.filter((caseRecord) =>
      Boolean(normalizeClientCode(getClientCode(caseRecord)))
    );
    const casesWithClientName = sameCountry.filter((caseRecord) =>
      Boolean(normalizeClientName(getClientName(caseRecord)))
    );
    const codeMatches = normalizedClientCode
      ? sameCountry.filter((caseRecord) =>
          normalizeClientCode(getClientCode(caseRecord)) === normalizedClientCode
        )
      : [];
    const nameMatches = sameCountry.filter((caseRecord) => {
      const caseClientName = normalizeClientName(getClientName(caseRecord));
      return Boolean(normalizedClientName && caseClientName && caseClientName === normalizedClientName);
    });
    const matched = codeMatches.length > 0 ? codeMatches : nameMatches;

    matched.sort((left, right) => {
      const closedDifference = Number(isClosed(left.estado)) - Number(isClosed(right.estado));
      return closedDifference || getTimestamp(right) - getTimestamp(left);
    });
    return res.status(200).json({
      success: true,
      pais: country,
      totalCasosPais: sameCountry.length,
      enlaceCliente: {
        casosConCliente: casesWithClient.length,
        casosConCodigoCliente: casesWithClientCode.length,
        casosConNombreCliente: casesWithClientName.length,
        coincidenciasCodigo: codeMatches.length,
        coincidenciasNombre: nameMatches.length,
      },
      reclamos: matched.map((caseRecord) => publicCase(caseRecord, country)),
    });
  } catch {
    return res.status(502).json({ success: false, error: 'RECLAMOS_UPSTREAM_UNAVAILABLE' });
  }
}
