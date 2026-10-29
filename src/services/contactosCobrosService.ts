import type { Country } from '../types';
import { supabase } from '../supabaseClient';

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

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    return { ...emptyResult, error: 'No fue posible validar la sesión de Supabase.' };
  }
  if (!sessionData.session) {
    return { ...emptyResult, requiresSupabaseAuth: true };
  }

  const [contactsResult, clientInfoResult] = await Promise.all([
    supabase
      .from('contactos_cobros')
      .select('id, pais, codigo_cliente, numero_contacto, nombre, cargo, telefono_fijo, correo, whatsapp')
      .eq('codigo_cliente', codigoCliente)
      .eq('pais', pais)
      .order('numero_contacto', { ascending: true }),
    supabase
      .from('informacion_cobros_cliente')
      .select('entrega_quedan, exige_factura_fisica, procedimientos_cobro')
      .eq('codigo_cliente', codigoCliente)
      .eq('pais', pais)
      .maybeSingle(),
  ]);

  if (contactsResult.error || clientInfoResult.error) {
    return {
      ...emptyResult,
      error: 'No se pudieron cargar los contactos. Verifica que la migración de Supabase esté aplicada.',
    };
  }

  return {
    contacts: (contactsResult.data || []) as ContactoCobros[],
    clientInfo: (clientInfoResult.data || null) as InformacionCobrosCliente | null,
    requiresSupabaseAuth: false,
    error: null,
  };
}
