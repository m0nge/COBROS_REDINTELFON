import type { AuthUser } from '../types';
import { supabase } from '../supabaseClient';

async function resolveAppUser(accessToken: string): Promise<AuthUser> {
  const response = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const result = await response.json().catch(() => null);
  if (!result) {
    throw new Error(
      response.status >= 500
        ? `El servidor de autenticación devolvió un error (${response.status}).`
        : 'El servidor devolvió una respuesta inválida al validar la cuenta.',
    );
  }
  if (!response.ok || !result.success || !result.user) {
    throw new Error(result.message || 'La cuenta no tiene un perfil activo autorizado en public.agentes.');
  }
  return result.user as AuthUser;
}

export async function loginWithPassword(email: string, password: string): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.session?.access_token) {
    throw new Error('Correo o contraseña incorrectos.');
  }

  try {
    return await resolveAppUser(data.session.access_token);
  } catch (error) {
    await supabase.auth.signOut();
    throw error;
  }
}

export async function restoreAppUser(): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error('No se pudo recuperar la sesión.');
  const token = data.session?.access_token;
  if (!token) return null;

  try {
    return await resolveAppUser(token);
  } catch (error) {
    await supabase.auth.signOut();
    throw error;
  }
}

type AuthSession = {
  access_token: string;
  expires_at?: number;
};

type AuthResponse = {
  data: { session: AuthSession | null };
  error: unknown;
};

type SessionAuthClient = {
  getSession: () => Promise<AuthResponse>;
  refreshSession: () => Promise<AuthResponse>;
};

export function createAuthenticatedApiFetch(
  auth: SessionAuthClient,
  request: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  return async (path: string, init: RequestInit = {}) => {
    let session: AuthSession | null = null;
    try {
      const current = await auth.getSession();
      if (!current.error) session = current.data.session;
    } catch {
      // A failed local session read is recoverable through the refresh token.
    }

    const expirationMs = Number(session?.expires_at) * 1000;
    const shouldRefreshBeforeRequest = !session?.access_token
      || (Number.isFinite(expirationMs) && expirationMs <= now() + 90_000);
    if (shouldRefreshBeforeRequest) {
      try {
        const refreshed = await auth.refreshSession();
        if (!refreshed.error && refreshed.data.session?.access_token) {
          session = refreshed.data.session;
        }
      } catch {
        // Use an access token that is still valid; fail below if it is expired.
      }
    }

    const token = session?.access_token || '';
    const latestExpirationMs = Number(session?.expires_at) * 1000;
    if (
      !token
      || (Number.isFinite(latestExpirationMs) && latestExpirationMs <= now())
    ) {
      throw new Error('Tu sesión terminó o no se pudo renovar. Inicia sesión de nuevo; la gestión no se guardó.');
    }

    const sendWithToken = (accessToken: string) => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${accessToken}`);
      if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      return request(path, { ...init, headers, cache: 'no-store' });
    };

    const response = await sendWithToken(token);
    if (response.status !== 401) return response;

    const errorPayload = await response.clone().json().catch(() => null) as { error?: unknown } | null;
    if (String(errorPayload?.error || '') !== 'UNAUTHORIZED') return response;

    // Our protected handlers authenticate before mutations. Replay once only
    // when they explicitly identify an authentication rejection.
    try {
      const refreshed = await auth.refreshSession();
      const refreshedToken = refreshed.error ? '' : refreshed.data.session?.access_token || '';
      if (!refreshedToken || refreshedToken === token) return response;
      return sendWithToken(refreshedToken);
    } catch {
      return response;
    }
  };
}

export const authenticatedApiFetch = createAuthenticatedApiFetch(supabase.auth);

export async function signOutAppUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error('No se pudo cerrar la sesión.');
}
