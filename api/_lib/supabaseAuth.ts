export interface AgentProfileRow {
  id: string;
  auth_id: string | null;
  nombre: string;
  email: string;
  telefono: string | null;
  pais: 'SV' | 'GT';
  rol: 'admin' | 'agente';
  estado: 'activo' | 'inactivo' | 'en_pausa';
  avatar_url: string | null;
  extension_pbx: string | null;
  tasa_efectividad: number | null;
}

export interface AuthenticatedAgent {
  authUser: { id: string; email?: string };
  agent: AgentProfileRow;
  supabaseUrl: string;
  serviceRoleKey: string;
}

export class ApiAuthError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

export function getSupabaseAdminConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new ApiAuthError('Authentication service is not configured.', 503, 'AUTH_NOT_CONFIGURED');
  }
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), serviceRoleKey };
}

function bearerToken(req: any) {
  const value = Array.isArray(req.headers?.authorization)
    ? req.headers.authorization[0]
    : req.headers?.authorization || req.headers?.Authorization;
  return String(value || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

export async function authenticateAgentRequest(req: any, requireAdmin = false): Promise<AuthenticatedAgent> {
  const token = bearerToken(req);
  if (!token) throw new ApiAuthError('Sign-in required.', 401, 'UNAUTHORIZED');

  const { supabaseUrl, serviceRoleKey } = getSupabaseAdminConfig();
  const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
  if (!authResponse.ok) throw new ApiAuthError('Invalid or expired session.', 401, 'UNAUTHORIZED');

  const authUser = await authResponse.json();
  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/agentes?select=id,auth_id,nombre,email,telefono,pais,rol,estado,avatar_url,extension_pbx,tasa_efectividad&auth_id=eq.${encodeURIComponent(authUser.id)}&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: 'no-store',
    },
  );
  if (!profileResponse.ok) {
    throw new ApiAuthError('Unable to verify the account profile.', 503, 'PROFILE_LOOKUP_FAILED');
  }

  const profiles = await profileResponse.json() as AgentProfileRow[];
  const agent = Array.isArray(profiles) ? profiles[0] : undefined;
  if (!agent || agent.estado !== 'activo') {
    throw new ApiAuthError('Active agent profile required.', 403, 'PROFILE_INACTIVE_OR_MISSING');
  }
  if (requireAdmin && agent.rol !== 'admin') {
    throw new ApiAuthError('Administrator access required.', 403, 'ADMIN_REQUIRED');
  }

  return { authUser, agent, supabaseUrl, serviceRoleKey };
}

export async function supabaseRestRequest(
  path: string,
  init: RequestInit = {},
  config = getSupabaseAdminConfig(),
) {
  const headers = new Headers(init.headers);
  headers.set('apikey', config.serviceRoleKey);
  headers.set('Authorization', `Bearer ${config.serviceRoleKey}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = response.status === 409
      ? 'The requested record conflicts with existing data.'
      : 'The database request failed.';
    throw new ApiAuthError(message, response.status >= 500 ? 502 : response.status, 'DATABASE_REQUEST_FAILED');
  }
  return { body, response };
}

export async function supabaseAuthAdminRequest(
  path: string,
  init: RequestInit = {},
  config = getSupabaseAdminConfig(),
) {
  const headers = new Headers(init.headers);
  headers.set('apikey', config.serviceRoleKey);
  headers.set('Authorization', `Bearer ${config.serviceRoleKey}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new ApiAuthError('The authentication account request failed.', response.status >= 500 ? 502 : response.status, 'AUTH_ACCOUNT_REQUEST_FAILED');
  }
  return body;
}

export function respondAuthError(res: any, error: unknown) {
  if (error instanceof ApiAuthError) {
    return res.status(error.status).json({ success: false, error: error.code, message: error.message });
  }
  return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Unexpected server error.' });
}
