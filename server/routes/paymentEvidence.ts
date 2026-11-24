import {
  assertAgentClientAccess,
  assertAgentCountryAccess,
  authenticateAgentRequest,
  respondAuthError,
  supabaseRestRequest,
} from '../supabaseAuth.js';

const PAYMENT_EVIDENCE_BUCKET = 'comprobantes-pago';

function queryText(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}

function isManagementId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default async function paymentEvidenceHandler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const context = await authenticateAgentRequest(req);
    const managementId = queryText(req.query?.gestion_id);
    if (!isManagementId(managementId)) {
      return res.status(400).json({ success: false, error: 'INVALID_MANAGEMENT_ID' });
    }

    const params = new URLSearchParams({
      select: 'id,agente_id,valores_dinamicos,clientes!inner(codigo,pais)',
      id: `eq.${managementId}`,
      limit: '1',
    });
    const { body } = await supabaseRestRequest(`bitacora_gestiones?${params.toString()}`, {}, context);
    if (!Array.isArray(body)) throw new Error('MANAGEMENT_LOOKUP_FAILED');
    const row = body[0];
    if (!row) return res.status(404).json({ success: false, error: 'MANAGEMENT_NOT_FOUND' });

    const client = Array.isArray(row.clientes) ? row.clientes[0] : row.clientes;
    const country = String(client?.pais || '').trim().toUpperCase();
    const clientCode = String(client?.codigo || '').trim().toUpperCase();
    const agentId = String(row.agente_id || '').trim();
    if (!agentId || !clientCode || (country !== 'SV' && country !== 'GT')) {
      return res.status(409).json({ success: false, error: 'MANAGEMENT_CLIENT_INVALID' });
    }
    assertAgentCountryAccess(context, country);
    if (context.agent.rol !== 'admin' && agentId !== context.agent.id) {
      await assertAgentClientAccess(context, country, clientCode);
    }

    const values = row.valores_dinamicos && typeof row.valores_dinamicos === 'object'
      && !Array.isArray(row.valores_dinamicos)
      ? row.valores_dinamicos as Record<string, unknown>
      : {};
    const evidencePath = queryText(values.paymentEvidencePath);
    const safeClientCode = clientCode.replace(/[^A-Z0-9_-]/g, '_');
    const pathSegments = evidencePath.split('/');
    const fileName = pathSegments.at(-1) || '';
    if (
      !evidencePath.startsWith(`${country}/${safeClientCode}/`)
      || pathSegments.length !== 4
      || !/^[A-Za-z0-9-]+$/.test(pathSegments[2] || '')
      || !/^[A-Za-z0-9_-]{1,100}\.(pdf|jpg|png|webp|gif)$/i.test(fileName)
    ) {
      return res.status(404).json({ success: false, error: 'PAYMENT_EVIDENCE_NOT_FOUND' });
    }

    const encodedPath = pathSegments.map((segment) => encodeURIComponent(segment)).join('/');
    const storageResponse = await fetch(
      `${context.supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(PAYMENT_EVIDENCE_BUCKET)}/${encodedPath}`,
      {
        method: 'POST',
        headers: {
          apikey: context.serviceRoleKey,
          Authorization: `Bearer ${context.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 300 }),
        cache: 'no-store',
      },
    );
    const storageBody = await storageResponse.json().catch(() => null) as {
      signedURL?: unknown;
      signedUrl?: unknown;
    } | null;
    const signedPath = typeof storageBody?.signedURL === 'string'
      ? storageBody.signedURL
      : typeof storageBody?.signedUrl === 'string'
        ? storageBody.signedUrl
        : '';
    if (!storageResponse.ok || !signedPath) {
      return res.status(502).json({ success: false, error: 'PAYMENT_EVIDENCE_UNAVAILABLE' });
    }

    const signedUrl = signedPath.startsWith('http')
      ? new URL(signedPath)
      : new URL(
        `/storage/v1${signedPath.startsWith('/') ? signedPath : `/${signedPath}`}`,
        context.supabaseUrl,
      );
    if (queryText(req.query?.download) === 'true') {
      signedUrl.searchParams.set('download', fileName);
    }
    return res.status(200).json({ success: true, signedUrl: signedUrl.toString() });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      return respondAuthError(res, error);
    }
    return res.status(502).json({
      success: false,
      error: 'PAYMENT_EVIDENCE_UNAVAILABLE',
      message: 'No se pudo preparar el comprobante de pago.',
    });
  }
}
