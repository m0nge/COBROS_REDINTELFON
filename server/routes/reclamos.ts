import {
  authenticateAgentRequest,
  respondAuthError,
} from '../supabaseAuth.js';

const API_URL = 'https://sac.red.com.sv/api/external/reclamos/sla';
const PAGE_SIZE = 5000;
const MAX_PAGES = 20;

type Country = 'SV' | 'GT';
type Reclamo = {
  case_id?: string | number;
  pais?: string;
  estado?: string;
  fecha_creacion?: string;
  fecha_actualizacion?: string;
  fecha_fin_sla?: string;
  slaExpired?: boolean;
  etapasVencidas?: unknown[];
  agente?: { nombre?: string; email?: string } | null;
  cliente?: { cliente_id?: string; nombre?: string } | null;
  categoria?: { nombre?: string } | string | null;
  [key: string]: unknown;
};

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

function isClosed(status: unknown): boolean {
  return ['finalizado', 'cerrado', 'resuelto'].includes(normalize(status));
}

function getTimestamp(caseRecord: Reclamo): number {
  const date = Date.parse(String(caseRecord.fecha_actualizacion || caseRecord.fecha_creacion || ''));
  return Number.isNaN(date) ? 0 : date;
}

function publicCase(caseRecord: Reclamo): Reclamo {
  const category = typeof caseRecord.categoria === 'string'
    ? caseRecord.categoria
    : caseRecord.categoria?.nombre;
  return {
    case_id: caseRecord.case_id,
    pais: caseRecord.pais,
    estado: caseRecord.estado,
    fecha_creacion: caseRecord.fecha_creacion,
    fecha_actualizacion: caseRecord.fecha_actualizacion,
    fecha_fin_sla: caseRecord.fecha_fin_sla,
    slaExpired: caseRecord.slaExpired,
    etapasVencidas: Array.isArray(caseRecord.etapasVencidas) ? caseRecord.etapasVencidas : [],
    agente: caseRecord.agente
      ? { nombre: caseRecord.agente.nombre, email: caseRecord.agente.email }
      : null,
    cliente: caseRecord.cliente
      ? { cliente_id: caseRecord.cliente.cliente_id, nombre: caseRecord.cliente.nombre }
      : null,
    categoria: category || null,
  };
}

async function fetchCases(country: Country, apiKey: string): Promise<Reclamo[]> {
  const allCases: Reclamo[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(API_URL);
    url.searchParams.set('pais', country);
    url.searchParams.set('tipo', 'todos');
    url.searchParams.set('includeClosed', 'true');
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
    const pageCases = extractCases(await response.json());
    allCases.push(...pageCases);
    if (pageCases.length < PAGE_SIZE) return allCases;
  }
  throw new Error('RECLAMOS_RESULT_TOO_LARGE');
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

  const countryValue = queryValue(req.query?.pais).toUpperCase();
  const country = (countryValue || agent.pais) as Country;
  const clientCode = queryValue(req.query?.clienteCodigo).trim();
  const clientName = normalize(queryValue(req.query?.clienteNombre));
  if (country !== 'SV' && country !== 'GT') {
    return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
  }
  if (agent.rol !== 'admin' && country !== agent.pais) {
    return res.status(403).json({ success: false, error: 'COUNTRY_ACCESS_DENIED' });
  }
  if (!clientCode && !clientName) {
    return res.status(400).json({ success: false, error: 'CLIENT_REQUIRED' });
  }

  const apiKey = process.env.RECLAMOS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'RECLAMOS_API_NOT_CONFIGURED' });
  }

  try {
    const allCases = await fetchCases(country, apiKey);
    const matched = allCases.filter((caseRecord) => {
      if (String(caseRecord.pais || '').toUpperCase() !== country) return false;
      const caseClientCode = String(caseRecord.cliente?.cliente_id || '').trim();
      if (clientCode) return caseClientCode === clientCode;
      const caseClientName = normalize(caseRecord.cliente?.nombre);
      return Boolean(clientName && caseClientName && caseClientName === clientName);
    });

    matched.sort((left, right) => {
      const closedDifference = Number(isClosed(left.estado)) - Number(isClosed(right.estado));
      return closedDifference || getTimestamp(right) - getTimestamp(left);
    });
    return res.status(200).json({
      success: true,
      pais: country,
      reclamos: matched.map(publicCase),
    });
  } catch {
    return res.status(502).json({ success: false, error: 'RECLAMOS_UPSTREAM_UNAVAILABLE' });
  }
}
