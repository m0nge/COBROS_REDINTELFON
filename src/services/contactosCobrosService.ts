import type { Country } from '../types';
import { authenticatedApiFetch } from './authService';

export interface ContactoCobros {
  id: string;
  pais: Country;
  codigo_cliente: string;
  numero_contacto: number;
  nombre: string | null;
  cargo: string | null;
  telefono_fijo: string | null;
  correo: string | null;
  whatsapp: string | null;
}

export interface InformacionCobrosCliente {
  entrega_quedan: boolean | null;
  exige_factura_fisica: boolean | null;
  procedimientos_cobro: string[];
}

export interface ContactosCobrosResult {
  contacts: ContactoCobros[];
  clientInfo: InformacionCobrosCliente | null;
  requiresSupabaseAuth: boolean;
  error: string | null;
}

export async function fetchContactosCobros(
  codigoCliente: string,
  pais: Country
): Promise<ContactosCobrosResult> {
  const emptyResult = {
    contacts: [],
    clientInfo: null,
    requiresSupabaseAuth: false,
    error: null,
  } satisfies ContactosCobrosResult;

  try {
    const params = new URLSearchParams({
      codigo_cliente: codigoCliente,
      pais,
    });
    const response = await authenticatedApiFetch(`/api/contactos-cobros?${params.toString()}`);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      const message = typeof payload?.message === 'string' ? payload.message : '';
      throw new Error(message || 'No se pudieron cargar los contactos.');
    }
    return {
      contacts: Array.isArray(payload.contactos) ? payload.contactos as ContactoCobros[] : [],
      clientInfo: payload.informacion && typeof payload.informacion === 'object'
        ? payload.informacion as InformacionCobrosCliente
        : null,
      requiresSupabaseAuth: false,
      error: null,
    };
  } catch {
    return {
      ...emptyResult,
      error: 'No se pudieron cargar los contactos compartidos del servidor.',
    };
  }
}
