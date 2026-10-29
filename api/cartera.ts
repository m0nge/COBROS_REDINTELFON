type Country = 'SV' | 'GT';
type RawClient = Record<string, unknown>;

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result || null;
}

function isActive(raw: RawClient): boolean {
  const status = String(
    raw.estatus || raw.status || raw.estado || raw.Estatus || raw.Status || raw.Estado || '',
  )
    .trim()
    .toUpperCase();
  if (
    status.includes('INACT') ||
    status.includes('BAJA') ||
    status.includes('CANCEL') ||
    status.includes('SUSPEND') ||
    status === 'NO ACTIVO' ||
    status === 'NO'
  ) {
    return false;
  }

  const classification = String(raw.clasificacion || raw.CLASIFICACION || '')
    .trim()
    .toUpperCase();
  return !(
    classification.includes('INACT') ||
    classification.includes('BAJA') ||
    classification.includes('CANCEL')
  );
}

function toClient(raw: RawClient, country: Country) {
  return {
    code: text(raw.Codigo || raw.codigo || raw.code) || '',
    name: text(raw.Nombre || raw.nombre || raw.name) || '',
    address: text(raw.address || raw.direccion),
    phone1: text(raw.phone1),
    phone2: text(raw.phone2),
    cell: text(raw.celular || raw.cell),
    celular: text(raw.celular || raw.cell),
    department: text(raw.departamento),
    municipality: text(raw.municipio),
    email: text(raw.correo || raw.email),
    classification: text(raw.clasificacion),
    salesManager: text(raw.gestorcomercial || raw.gestor_comercial),
    managerEmail: text(raw.emailgestor || raw.email_gestor),
    managerCode: text(raw.codigogestor || raw.codigo_gestor),
    country,
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const queryCountry = String(req.query?.pais || '').toUpperCase();
  if (queryCountry !== 'SV' && queryCountry !== 'GT') {
    return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
  }
  const country = queryCountry as Country;
  const sapKey = process.env.SAP_API_KEY;
  if (!sapKey) {
    return res.status(503).json({ success: false, error: 'SAP_NOT_CONFIGURED' });
  }

  const url = new URL('https://sapapi.red.com.sv/api/Cliente/clienteasignado');
  url.searchParams.set('var_pais', country);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'X-API-KEY': sapKey, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return res.status(502).json({
        success: false,
        error: 'SAP_UPSTREAM_FAILED',
        upstreamStatus: response.status,
      });
    }

    const rawRows = await response.json();
    if (!Array.isArray(rawRows)) {
      return res.status(502).json({ success: false, error: 'SAP_RESPONSE_INVALID' });
    }

    const clients = (rawRows as RawClient[])
      .filter((client) => client && typeof client === 'object' && isActive(client))
      .map((client) => toClient(client, country));

    return res.status(200).json({
      success: true,
      count: clients.length,
      pais: country,
      lastSync: new Date().toISOString(),
      clients,
    });
  } catch {
    return res.status(502).json({ success: false, error: 'SAP_REQUEST_FAILED' });
  } finally {
    clearTimeout(timeout);
  }
}
