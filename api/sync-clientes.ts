import { createHmac, timingSafeEqual } from 'node:crypto';

const COUNTRIES = ['SV', 'GT'] as const;
type Country = (typeof COUNTRIES)[number];
type RawClient = Record<string, unknown>;
type ClientRow = {
  codigo: string;
  nombre: string;
  pais: Country;
  direccion: string | null;
  phone1: string | null;
  phone2: string | null;
  celular: string | null;
  departamento: string | null;
  municipio: string | null;
  correo: string | null;
  clasificacion: string | null;
  gestor_comercial: string | null;
  email_gestor: string | null;
  codigo_gestor: string | null;
};

type CountryStats = {
  received: number;
  ready: number;
  missingCode: number;
  missingName: number;
  duplicates: number;
  namesUnderSixCharacters: number;
  invalidEmails: number;
  phonesUnderEightDigits: number;
  newRows: number;
  existingRows: number;
};

class SafeUpstreamError extends Error {
  constructor(
    readonly system: 'SAP' | 'SUPABASE',
    readonly status?: number,
  ) {
    super(system);
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pickText(source: RawClient, ...keys: string[]): string | null {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
  }
  return null;
}

function optionalText(source: RawClient, ...keys: string[]): string | null {
  return pickText(source, ...keys);
}

function normalizedEmail(source: RawClient, ...keys: string[]) {
  const value = optionalText(source, ...keys);
  if (!value) return { value: null, invalid: false };
  return EMAIL_PATTERN.test(value)
    ? { value, invalid: false }
    : { value: null, invalid: true };
}

function normalizedPhone(source: RawClient, ...keys: string[]) {
  const value = optionalText(source, ...keys);
  if (!value) return { value: null, invalid: false };
  return value.replace(/\D/g, '').length >= 8
    ? { value, invalid: false }
    : { value: null, invalid: true };
}

function emptyStats(): CountryStats {
  return {
    received: 0,
    ready: 0,
    missingCode: 0,
    missingName: 0,
    duplicates: 0,
    namesUnderSixCharacters: 0,
    invalidEmails: 0,
    phonesUnderEightDigits: 0,
    newRows: 0,
    existingRows: 0,
  };
}

function collectRows(rawRows: unknown[], country: Country) {
  const stats = emptyStats();
  const uniqueRows = new Map<string, ClientRow>();

  for (const item of rawRows) {
    stats.received += 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      stats.missingCode += 1;
      stats.missingName += 1;
      continue;
    }

    const source = item as RawClient;
    const codigo = pickText(source, 'Codigo', 'codigo', 'code');
    const nombre = pickText(source, 'Nombre', 'nombre', 'name');
    if (!codigo) stats.missingCode += 1;
    if (!nombre) stats.missingName += 1;
    if (!codigo || !nombre) continue;

    const dedupeKey = codigo.toUpperCase();
    if (uniqueRows.has(dedupeKey)) {
      stats.duplicates += 1;
      continue;
    }

    const email = normalizedEmail(source, 'correo', 'email');
    const managerEmail = normalizedEmail(source, 'emailgestor', 'email_gestor');
    const phone1 = normalizedPhone(source, 'phone1');
    const phone2 = normalizedPhone(source, 'phone2');
    const celular = normalizedPhone(source, 'celular', 'cell');

    if (nombre.length < 6) stats.namesUnderSixCharacters += 1;
    if (email.invalid) stats.invalidEmails += 1;
    if (managerEmail.invalid) stats.invalidEmails += 1;
    if (phone1.invalid) stats.phonesUnderEightDigits += 1;
    if (phone2.invalid) stats.phonesUnderEightDigits += 1;
    if (celular.invalid) stats.phonesUnderEightDigits += 1;

    uniqueRows.set(dedupeKey, {
      codigo,
      nombre,
      pais: country,
      direccion: optionalText(source, 'address', 'direccion'),
      phone1: phone1.value,
      phone2: phone2.value,
      celular: celular.value,
      departamento: optionalText(source, 'departamento'),
      municipio: optionalText(source, 'municipio'),
      correo: email.value,
      clasificacion: optionalText(source, 'clasificacion'),
      gestor_comercial: optionalText(source, 'gestorcomercial', 'gestor_comercial'),
      email_gestor: managerEmail.value,
      codigo_gestor: optionalText(source, 'codigogestor', 'codigo_gestor'),
    });
  }

  const rows = Array.from(uniqueRows.values());
  stats.ready = rows.length;
  return { rows, stats };
}

function sameSecret(presented: string, expected: string): boolean {
  const left = Buffer.from(presented, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function makePreviewId(
  rows: ClientRow[],
  existing: Array<Record<string, unknown>>,
  token: string,
): string {
  const existingKeys = existing
    .map((row) => keyFor(row.codigo, row.pais))
    .sort();
  return createHmac('sha256', token)
    .update(JSON.stringify({ rows, existingKeys }))
    .digest('hex');
}

async function fetchJson(url: string, init: RequestInit, system: 'SAP' | 'SUPABASE') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new SafeUpstreamError(system, response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof SafeUpstreamError) throw error;
    throw new SafeUpstreamError(system);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCountry(country: Country, sapKey: string): Promise<unknown[]> {
  const url = new URL('https://sapapi.red.com.sv/api/Cliente/clienteasignado');
  url.searchParams.set('var_pais', country);
  const payload = await fetchJson(
    url.toString(),
    {
      method: 'GET',
      headers: { 'X-API-KEY': sapKey, Accept: 'application/json' },
    },
    'SAP',
  );
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new SafeUpstreamError('SAP');
  }
  return payload;
}

async function fetchExistingClients(supabaseUrl: string, serviceRoleKey: string) {
  const url = new URL('/rest/v1/clientes', supabaseUrl);
  url.searchParams.set(
    'select',
    'codigo,pais,direccion,phone1,phone2,celular,departamento,municipio,correo,clasificacion,gestor_comercial,email_gestor,codigo_gestor',
  );
  url.searchParams.set('limit', '2000');
  const payload = await fetchJson(
    url.toString(),
    {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: 'application/json',
      },
    },
    'SUPABASE',
  );
  if (!Array.isArray(payload)) throw new SafeUpstreamError('SUPABASE');
  return payload as Array<Record<string, unknown>>;
}

function keyFor(code: unknown, country: unknown): string {
  return `${String(country || '').toUpperCase()}:${String(code || '').trim().toUpperCase()}`;
}

function attachExistingCounts(
  statsByCountry: Record<Country, CountryStats>,
  rows: ClientRow[],
  existing: Array<Record<string, unknown>>,
) {
  const existingKeys = new Set(existing.map((row) => keyFor(row.codigo, row.pais)));
  for (const row of rows) {
    const stats = statsByCountry[row.pais];
    if (existingKeys.has(keyFor(row.codigo, row.pais))) stats.existingRows += 1;
    else stats.newRows += 1;
  }
}

function preserveExistingOptionalFields(
  rows: ClientRow[],
  existing: Array<Record<string, unknown>>,
): ClientRow[] {
  const existingByKey = new Map(existing.map((row) => [keyFor(row.codigo, row.pais), row]));
  const optionalColumns: Array<keyof ClientRow> = [
    'direccion',
    'phone1',
    'phone2',
    'celular',
    'departamento',
    'municipio',
    'correo',
    'clasificacion',
    'gestor_comercial',
    'email_gestor',
    'codigo_gestor',
  ];

  return rows.map((row) => {
    const existingRow = existingByKey.get(keyFor(row.codigo, row.pais));
    if (!existingRow) return row;
    const merged = { ...row };
    for (const column of optionalColumns) {
      if (merged[column] === null) {
        const oldValue = existingRow[column];
        merged[column] = oldValue === null || oldValue === undefined ? null : String(oldValue);
      }
    }
    return merged;
  });
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (String(req.method || '').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const syncToken = process.env.CLIENTES_SYNC_TOKEN;
  const sapKey = process.env.SAP_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!syncToken || !sapKey || !supabaseUrl || !serviceRoleKey) {
    return res.status(503).json({ success: false, error: 'SYNC_NOT_CONFIGURED' });
  }

  const authHeader = Array.isArray(req.headers?.authorization)
    ? req.headers.authorization[0]
    : req.headers?.authorization;
  const presentedToken = String(authHeader || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!presentedToken || !sameSecret(presentedToken, syncToken)) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }

  const action = req.body?.action;
  if (action !== 'preview' && action !== 'sync') {
    return res.status(400).json({ success: false, error: 'INVALID_ACTION' });
  }

  try {
    const countryPayloads = await Promise.all(
      COUNTRIES.map((country) => fetchCountry(country, sapKey)),
    );
    const collected = COUNTRIES.map((country, index) =>
      collectRows(countryPayloads[index], country),
    );
    const rows = collected.flatMap((result) => result.rows);
    const statsByCountry = {
      SV: collected[0].stats,
      GT: collected[1].stats,
    };
    const existing = await fetchExistingClients(supabaseUrl, serviceRoleKey);
    attachExistingCounts(statsByCountry, rows, existing);
    const previewId = makePreviewId(rows, existing, syncToken);
    if (statsByCountry.SV.ready === 0 || statsByCountry.GT.ready === 0) {
      return res.status(422).json({
        success: false,
        error: 'NO_VALID_CLIENTS_FOR_COUNTRY',
        countries: statsByCountry,
      });
    }

    if (action === 'preview') {
      return res.status(200).json({
        success: true,
        action: 'preview',
        previewId,
        total: {
          received: statsByCountry.SV.received + statsByCountry.GT.received,
          ready: rows.length,
          newRows: statsByCountry.SV.newRows + statsByCountry.GT.newRows,
          existingRows: statsByCountry.SV.existingRows + statsByCountry.GT.existingRows,
        },
        countries: statsByCountry,
        fields: [
          'codigo',
          'nombre',
          'pais',
          'direccion',
          'phone1',
          'phone2',
          'celular',
          'departamento',
          'municipio',
          'correo',
          'clasificacion',
          'gestor_comercial',
          'email_gestor',
          'codigo_gestor',
        ],
        note: 'Debt, collection status, and management history are not changed.',
      });
    }

    if (String(req.body?.previewId || '') !== previewId) {
      return res.status(409).json({ success: false, error: 'PREVIEW_STALE' });
    }

    const rowsToUpsert = preserveExistingOptionalFields(rows, existing);
    const upsertUrl = new URL('/rest/v1/clientes', supabaseUrl);
    upsertUrl.searchParams.set('on_conflict', 'codigo,pais');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let supabaseResponse: Response;
    try {
      supabaseResponse = await fetch(upsertUrl.toString(), {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(rowsToUpsert),
        signal: controller.signal,
      });
    } catch {
      return res.status(502).json({ success: false, error: 'SUPABASE_UPSERT_FAILED' });
    } finally {
      clearTimeout(timeout);
    }

    if (!supabaseResponse.ok) {
      return res.status(502).json({
        success: false,
        error: 'SUPABASE_UPSERT_FAILED',
        upstreamStatus: supabaseResponse.status,
      });
    }

    return res.status(200).json({
      success: true,
      action: 'sync',
      totalUpserted: rowsToUpsert.length,
      countries: statsByCountry,
      note: 'Debt, collection status, and management history were not changed.',
    });
  } catch (error) {
    if (error instanceof SafeUpstreamError) {
      return res.status(502).json({
        success: false,
        error: `${error.system}_REQUEST_FAILED`,
        ...(error.status ? { upstreamStatus: error.status } : {}),
      });
    }
    return res.status(500).json({ success: false, error: 'SYNC_FAILED' });
  }
}
