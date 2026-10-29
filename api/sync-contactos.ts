import { createHmac, timingSafeEqual } from 'node:crypto';

const COUNTRIES = ['SV', 'GT'] as const;
type Country = (typeof COUNTRIES)[number];
type RawRow = Record<string, unknown>;

type ContactRow = {
  codigo_cliente: string;
  pais: Country;
  numero_contacto: number;
  nombre: string | null;
  cargo: string | null;
  telefono_fijo: string | null;
  correo: string | null;
  whatsapp: string | null;
  updated_at?: string;
};

type InformationRow = {
  codigo_cliente: string;
  pais: Country;
  entrega_quedan: boolean | null;
  exige_factura_fisica: boolean | null;
  procedimientos_cobro: string[];
  updated_at?: string;
};

type Counts = {
  sourceRows: number;
  readyRows: number;
  newRows: number;
  existingRows: number;
  missingCode: number;
  invalidCountry: number;
  unmatchedClients: number;
  duplicateKeys: number;
  aggregatedRows: number;
  conflictingValues: number;
  invalidKeys: number;
  blankRows: number;
  shortNames: number;
  shortPhones: number;
  invalidEmails: number;
  invalidBooleans: number;
};

type SafeError = {
  system: 'SUPABASE';
  status?: number;
};

class UpstreamError extends Error {
  readonly system = 'SUPABASE' as const;

  constructor(readonly status?: number) {
    super('SUPABASE');
  }
}

type ExistingSnapshot = {
  clients: RawRow[];
  contacts: RawRow[];
  information: RawRow[];
};

type SyncPlan = {
  contacts: ContactRow[];
  information: InformationRow[];
  contactCounts: Counts;
  informationCounts: Counts;
  canSync: boolean;
  previewId: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_OPTIONAL_FIELDS = [
  'nombre',
  'cargo',
  'telefono_fijo',
  'correo',
  'whatsapp',
] as const;

function emptyCounts(sourceRows = 0): Counts {
  return {
    sourceRows,
    readyRows: 0,
    newRows: 0,
    existingRows: 0,
    missingCode: 0,
    invalidCountry: 0,
    unmatchedClients: 0,
    duplicateKeys: 0,
    aggregatedRows: 0,
    conflictingValues: 0,
    invalidKeys: 0,
    blankRows: 0,
    shortNames: 0,
    shortPhones: 0,
    invalidEmails: 0,
    invalidBooleans: 0,
  };
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeCountry(value: unknown): Country | null {
  const country = String(value ?? '').trim().toUpperCase();
  return country === 'SV' || country === 'GT' ? country : null;
}

function normalizedCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function mergeProcedures(...lists: (unknown[] | null | undefined)[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      const procedure = cleanText(value);
      if (!procedure) continue;
      const key = procedure.normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('es');
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(procedure);
    }
  }
  return merged;
}

function clientKey(country: Country, code: string): string {
  return `${country}|${normalizedCode(code)}`;
}

function contactKey(country: Country, code: string, number: number): string {
  return `${clientKey(country, code)}|${number}`;
}

function validName(value: string | null): boolean {
  if (!value) return true;
  return value.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '').length >= 6;
}

function validPhone(value: string | null): boolean {
  if (!value) return true;
  return value.replace(/\D/g, '').length >= 8;
}

function normalizedEmail(value: string | null, counts: Counts): string | null {
  if (!value) return null;
  if (EMAIL_PATTERN.test(value)) return value;
  counts.invalidEmails += 1;
  return null;
}

function normalizedPhone(value: string | null, counts: Counts): string | null {
  if (!value) return null;
  if (validPhone(value)) return value;
  counts.shortPhones += 1;
  return null;
}

function normalizedName(value: string | null, counts: Counts): string | null {
  if (!value) return null;
  if (validName(value)) return value;
  counts.shortNames += 1;
  return null;
}

function parseBoolean(value: unknown, counts: Counts): boolean | null {
  const text = cleanText(value);
  if (!text) return null;
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (['si', 's', 'yes', 'y', 'true', '1'].includes(normalized)) return true;
  if (['no', 'n', 'false', '0'].includes(normalized)) return false;
  counts.invalidBooleans += 1;
  return null;
}

function keyForContactRow(row: RawRow): string | null {
  const country = normalizeCountry(row.pais);
  const code = cleanText(row.codigo_cliente);
  const number = Number(row.numero_contacto);
  if (!country || !code || !Number.isInteger(number) || number < 1) return null;
  return contactKey(country, code, number);
}

function keyForInformationRow(row: RawRow): string | null {
  const country = normalizeCountry(row.pais);
  const code = cleanText(row.codigo_cliente);
  if (!country || !code) return null;
  return clientKey(country, code);
}

function sameSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function fetchSupabaseRows(
  supabaseUrl: string,
  serviceRoleKey: string,
  table: string,
  columns: string,
): Promise<RawRow[]> {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  url.searchParams.set('select', columns);
  url.searchParams.set('limit', '10000');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new UpstreamError(response.status);
    const data = await response.json();
    if (!Array.isArray(data)) throw new UpstreamError(response.status);
    return data as RawRow[];
  } finally {
    clearTimeout(timeout);
  }
}

async function upsertSupabaseRows(
  supabaseUrl: string,
  serviceRoleKey: string,
  table: string,
  conflictColumns: string,
  rows: Array<ContactRow | InformationRow>,
): Promise<void> {
  if (rows.length === 0) return;
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  url.searchParams.set('on_conflict', conflictColumns);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
      signal: controller.signal,
    });
    if (!response.ok) throw new UpstreamError(response.status);
  } finally {
    clearTimeout(timeout);
  }
}

function preserveContactFields(
  rows: ContactRow[],
  existingRows: RawRow[],
): ContactRow[] {
  const existingByKey = new Map<string, RawRow>();
  for (const row of existingRows) {
    const key = keyForContactRow(row);
    if (key) existingByKey.set(key, row);
  }
  return rows.map((row) => {
    const existing = existingByKey.get(
      contactKey(row.pais, row.codigo_cliente, row.numero_contacto),
    );
    if (!existing) return row;
    const merged: ContactRow = { ...row };
    for (const field of CONTACT_OPTIONAL_FIELDS) {
      if (merged[field] === null && existing[field] !== null && existing[field] !== undefined) {
        merged[field] = String(existing[field]);
      }
    }
    return merged;
  });
}

function preserveInformationFields(
  rows: InformationRow[],
  existingRows: RawRow[],
): InformationRow[] {
  const existingByKey = new Map<string, RawRow>();
  for (const row of existingRows) {
    const key = keyForInformationRow(row);
    if (key) existingByKey.set(key, row);
  }
  return rows.map((row) => {
    const existing = existingByKey.get(clientKey(row.pais, row.codigo_cliente));
    if (!existing) return row;
    return {
      ...row,
      entrega_quedan:
        row.entrega_quedan === null && existing.entrega_quedan !== null
          ? (existing.entrega_quedan as boolean | null)
          : row.entrega_quedan,
      exige_factura_fisica:
        row.exige_factura_fisica === null && existing.exige_factura_fisica !== null
          ? (existing.exige_factura_fisica as boolean | null)
          : row.exige_factura_fisica,
      procedimientos_cobro: mergeProcedures(
        Array.isArray(existing.procedimientos_cobro)
          ? existing.procedimientos_cobro
          : [],
        row.procedimientos_cobro,
      ),
    };
  });
}

function buildPlan(
  contactSources: RawRow[],
  informationSources: RawRow[],
  snapshot: ExistingSnapshot,
  token: string,
): SyncPlan {
  const contactCounts = emptyCounts(contactSources.length);
  const informationCounts = emptyCounts(informationSources.length);
  const clientByKey = new Map<string, { codigo: string; pais: Country }>();
  for (const client of snapshot.clients) {
    const country = normalizeCountry(client.pais);
    const code = cleanText(client.codigo);
    if (country && code) {
      clientByKey.set(clientKey(country, code), { codigo: code, pais: country });
    }
  }

  const existingContactsByKey = new Map<string, RawRow>();
  for (const existing of snapshot.contacts) {
    const key = keyForContactRow(existing);
    if (key) existingContactsByKey.set(key, existing);
  }
  const contactByKey = new Map<string, ContactRow>();
  const duplicateContactKeys = new Set<string>();

  for (const source of contactSources) {
    const rawCode = cleanText(source.codigo_cliente);
    if (!rawCode) {
      contactCounts.missingCode += 1;
      continue;
    }
    const country = normalizeCountry(source.pais);
    if (!country) {
      contactCounts.invalidCountry += 1;
      continue;
    }
    const number = Number(source.numero_contacto);
    if (!Number.isInteger(number) || number < 1 || number > 32767) {
      contactCounts.invalidKeys += 1;
      continue;
    }
    const client = clientByKey.get(clientKey(country, rawCode));
    if (!client) {
      contactCounts.unmatchedClients += 1;
      continue;
    }

    const key = contactKey(country, client.codigo, number);
    if (duplicateContactKeys.has(key) || contactByKey.has(key)) {
      duplicateContactKeys.add(key);
      contactByKey.delete(key);
      contactCounts.duplicateKeys += 1;
      continue;
    }

    const name = normalizedName(cleanText(source.nombre), contactCounts);
    const phone = normalizedPhone(cleanText(source.telefono_fijo), contactCounts);
    const whatsapp = normalizedPhone(cleanText(source.whatsapp), contactCounts);
    const email = normalizedEmail(cleanText(source.correo), contactCounts);
    const cargo = cleanText(source.cargo);
    if (!name && !cargo && !phone && !email && !whatsapp) {
      contactCounts.blankRows += 1;
      continue;
    }

    contactByKey.set(key, {
      codigo_cliente: client.codigo,
      pais: country,
      numero_contacto: number,
      nombre: name,
      cargo,
      telefono_fijo: phone,
      correo: email,
      whatsapp,
    });
  }
  const contacts = [...contactByKey.values()];
  for (const row of contacts) {
    contactCounts.readyRows += 1;
    if (existingContactsByKey.has(contactKey(row.pais, row.codigo_cliente, row.numero_contacto))) {
      contactCounts.existingRows += 1;
    } else {
      contactCounts.newRows += 1;
    }
  }

  const existingInformationByKey = new Map<string, RawRow>();
  for (const existing of snapshot.information) {
    const key = keyForInformationRow(existing);
    if (key) existingInformationByKey.set(key, existing);
  }
  const informationByKey = new Map<string, InformationRow>();

  for (const source of informationSources) {
    const rawCode = cleanText(source.codigo_cliente);
    if (!rawCode) {
      informationCounts.missingCode += 1;
      continue;
    }
    const country = normalizeCountry(source.pais);
    if (!country) {
      informationCounts.invalidCountry += 1;
      continue;
    }
    const client = clientByKey.get(clientKey(country, rawCode));
    if (!client) {
      informationCounts.unmatchedClients += 1;
      continue;
    }

    const key = clientKey(country, client.codigo);
    const entregaQuedan = parseBoolean(source.entrega_quedan, informationCounts);
    const exigeFactura = parseBoolean(source.exige_factura_fisica, informationCounts);
    const procedure = cleanText(source.procedimiento_cobros);
    if (entregaQuedan === null && exigeFactura === null && !procedure) {
      informationCounts.blankRows += 1;
      continue;
    }

    const existing = informationByKey.get(key);
    if (!existing) {
      informationByKey.set(key, {
        codigo_cliente: client.codigo,
        pais: country,
        entrega_quedan: entregaQuedan,
        exige_factura_fisica: exigeFactura,
        procedimientos_cobro: procedure ? [procedure] : [],
      });
      continue;
    }

    informationCounts.aggregatedRows += 1;
    const mergeBoolean = (current: boolean | null, incoming: boolean | null) => {
      if (current !== null && incoming !== null && current !== incoming) {
        informationCounts.conflictingValues += 1;
        return current;
      }
      return current ?? incoming;
    };
    existing.entrega_quedan = mergeBoolean(existing.entrega_quedan, entregaQuedan);
    existing.exige_factura_fisica = mergeBoolean(
      existing.exige_factura_fisica,
      exigeFactura,
    );
    existing.procedimientos_cobro = mergeProcedures(
      existing.procedimientos_cobro,
      procedure ? [procedure] : [],
    );
  }
  const information = [...informationByKey.values()];
  for (const row of information) {
    informationCounts.readyRows += 1;
    if (existingInformationByKey.has(clientKey(row.pais, row.codigo_cliente))) {
      informationCounts.existingRows += 1;
    } else {
      informationCounts.newRows += 1;
    }
  }

  const blockingProblems = [
    contactCounts.missingCode,
    contactCounts.invalidCountry,
    contactCounts.unmatchedClients,
    contactCounts.duplicateKeys,
    contactCounts.invalidKeys,
    informationCounts.missingCode,
    informationCounts.invalidCountry,
    informationCounts.unmatchedClients,
    informationCounts.duplicateKeys,
    informationCounts.conflictingValues,
  ].some((count) => count > 0);
  const canSync =
    contacts.length > 0 &&
    information.length > 0 &&
    !blockingProblems;

  const digestPayload = JSON.stringify({
    contacts: contacts.slice().sort((a, b) =>
      contactKey(a.pais, a.codigo_cliente, a.numero_contacto).localeCompare(
        contactKey(b.pais, b.codigo_cliente, b.numero_contacto),
      ),
    ),
    information: information.slice().sort((a, b) =>
      clientKey(a.pais, a.codigo_cliente).localeCompare(
        clientKey(b.pais, b.codigo_cliente),
      ),
    ),
    contactCounts,
    informationCounts,
    clients: [...clientByKey.keys()].sort(),
    existingContacts: snapshot.contacts.slice().sort((a, b) =>
      String(keyForContactRow(a)).localeCompare(String(keyForContactRow(b))),
    ),
    existingInformation: snapshot.information.slice().sort((a, b) =>
      String(keyForInformationRow(a)).localeCompare(String(keyForInformationRow(b))),
    ),
  });
  const previewId = createHmac('sha256', token).update(digestPayload).digest('hex');

  return {
    contacts,
    information,
    contactCounts,
    informationCounts,
    canSync,
    previewId,
  };
}

async function loadSnapshot(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<{ sources: { contacts: RawRow[]; information: RawRow[] }; snapshot: ExistingSnapshot }> {
  const [
    contactSources,
    informationSources,
    clients,
    contacts,
    information,
  ] = await Promise.all([
    fetchSupabaseRows(
      supabaseUrl,
      serviceRoleKey,
      'contactos_cobros_import',
      'source_sheet,source_row,pais,codigo_cliente,numero_contacto,nombre,cargo,telefono_fijo,correo,whatsapp',
    ),
    fetchSupabaseRows(
      supabaseUrl,
      serviceRoleKey,
      'informacion_cobros_import',
      'source_sheet,source_row,pais,codigo_cliente,entrega_quedan,exige_factura_fisica,procedimiento_cobros',
    ),
    fetchSupabaseRows(supabaseUrl, serviceRoleKey, 'clientes', 'codigo,pais'),
    fetchSupabaseRows(
      supabaseUrl,
      serviceRoleKey,
      'contactos_cobros',
      'codigo_cliente,pais,numero_contacto,nombre,cargo,telefono_fijo,correo,whatsapp',
    ),
    fetchSupabaseRows(
      supabaseUrl,
      serviceRoleKey,
      'informacion_cobros_cliente',
      'codigo_cliente,pais,entrega_quedan,exige_factura_fisica,procedimientos_cobro',
    ),
  ]);
  return {
    sources: { contacts: contactSources, information: informationSources },
    snapshot: { clients, contacts, information },
  };
}

function safeError(error: unknown): SafeError | null {
  return error instanceof UpstreamError
    ? { system: error.system, status: error.status }
    : null;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (String(req.method || '').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const syncToken = process.env.CLIENTES_SYNC_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!syncToken || !supabaseUrl || !serviceRoleKey) {
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
    const { sources, snapshot } = await loadSnapshot(supabaseUrl, serviceRoleKey);
    const plan = buildPlan(sources.contacts, sources.information, snapshot, syncToken);
    if (action === 'preview') {
      return res.status(200).json({
        success: true,
        action: 'preview',
        previewId: plan.previewId,
        canSync: plan.canSync,
        tables: {
          contactos_cobros: plan.contactCounts,
          informacion_cobros_cliente: plan.informationCounts,
        },
        fields: {
          contactos_cobros: [
            'codigo_cliente',
            'pais',
            'numero_contacto',
            'nombre',
            'cargo',
            'telefono_fijo',
            'correo',
            'whatsapp',
          ],
          informacion_cobros_cliente: [
            'codigo_cliente',
            'pais',
            'entrega_quedan',
            'exige_factura_fisica',
            'procedimientos_cobro',
          ],
        },
        note: 'Only the two contact/information tables are changed; cliente debt, status and management history are untouched.',
      });
    }

    if (String(req.body?.previewId || '') !== plan.previewId) {
      return res.status(409).json({ success: false, error: 'PREVIEW_STALE' });
    }
    if (!plan.canSync) {
      return res.status(422).json({
        success: false,
        error: 'SOURCE_VALIDATION_FAILED',
        tables: {
          contactos_cobros: plan.contactCounts,
          informacion_cobros_cliente: plan.informationCounts,
        },
      });
    }

    const updatedAt = new Date().toISOString();
    const contactRows = preserveContactFields(plan.contacts, snapshot.contacts).map((row) => ({
      ...row,
      updated_at: updatedAt,
    }));
    const informationRows = preserveInformationFields(
      plan.information,
      snapshot.information,
    ).map((row) => ({ ...row, updated_at: updatedAt }));
    await upsertSupabaseRows(
      supabaseUrl,
      serviceRoleKey,
      'contactos_cobros',
      'codigo_cliente,pais,numero_contacto',
      contactRows,
    );
    try {
      await upsertSupabaseRows(
        supabaseUrl,
        serviceRoleKey,
        'informacion_cobros_cliente',
        'codigo_cliente,pais',
        informationRows,
      );
    } catch (error) {
      const upstream = safeError(error);
      return res.status(502).json({
        success: false,
        error: 'PARTIAL_SYNC_CONTACTS_DONE',
        contactsUpserted: contactRows.length,
        upstreamStatus: upstream?.status,
      });
    }

    return res.status(200).json({
      success: true,
      action: 'sync',
      tables: {
        contactos_cobros: plan.contactCounts,
        informacion_cobros_cliente: plan.informationCounts,
      },
      note: 'Both contact/information tables were upserted; cliente debt, status and management history were untouched.',
    });
  } catch (error) {
    const upstream = safeError(error);
    if (upstream) {
      return res.status(502).json({
        success: false,
        error: 'SUPABASE_UPSTREAM_FAILED',
        upstreamStatus: upstream.status,
      });
    }
    return res.status(500).json({ success: false, error: 'SYNC_FAILED' });
  }
}
