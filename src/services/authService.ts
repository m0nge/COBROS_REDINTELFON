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

export async function authenticatedApiFetch(path: string, init: RequestInit = {}) {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error('Tu sesión terminó. Inicia sesión de nuevo.');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(path, { ...init, headers, cache: 'no-store' });
}

export async function signOutAppUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error('No se pudo cerrar la sesión.');
}
