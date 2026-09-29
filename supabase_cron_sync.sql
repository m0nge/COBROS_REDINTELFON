-- ==============================================================================
-- SUPABASE CRON & EDGE FUNCTION: SINCRONIZACIÓN AUTOMÁTICA DE CARTERA SAP
-- Este script permite programar una tarea cron recurrente en Supabase
-- para consultar la API de SAP cada hora (o al inicio de mes) y mantener
-- la tabla 'clientes' y 'facturas_mora' siempre actualizada en tiempo real.
-- ==============================================================================

-- 1. Habilitar extensiones necesarias en Supabase (si aún no están activadas)
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "pg_net";

-- 2. Función PL/pgSQL para llamar al endpoint de sincronización
CREATE OR REPLACE FUNCTION public.sincronizar_cartera_sap()
RETURNS void AS $$
DECLARE
    endpoint_url TEXT := 'https://sapapi.red.com.sv/api/Cliente/clienteasignado?var_pais=SV';
    api_key TEXT := 'fdf0cb340b00402c00a057b0f67c00a3';
BEGIN
    -- Utiliza pg_net para enviar una solicitud GET asíncrona a la API de SAP
    PERFORM net.http_get(
        url := endpoint_url,
        headers := jsonb_build_object(
            'X-API-KEY', api_key,
            'Content-Type', 'application/json'
        )
    );
    
    -- También consultar cartera de Guatemala (GT)
    PERFORM net.http_get(
        url := 'https://sapapi.red.com.sv/api/Cliente/clienteasignado?var_pais=GT',
        headers := jsonb_build_object(
            'X-API-KEY', api_key,
            'Content-Type', 'application/json'
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Programación con pg_cron:
-- Opción A: Cada hora en punto para detectar clientes que pagaron o nuevos clientes:
-- SELECT cron.schedule('sync-sap-hourly', '0 * * * *', 'SELECT public.sincronizar_cartera_sap();');

-- Opción B: Cada día a las 06:00 AM:
-- SELECT cron.schedule('sync-sap-daily-morning', '0 6 * * *', 'SELECT public.sincronizar_cartera_sap();');

-- Opción C: El día 1 de cada mes a las 00:01 AM (emisión de facturación mensual y reasignación de mora):
-- SELECT cron.schedule('sync-sap-monthly-billing', '1 0 1 * *', 'SELECT public.sincronizar_cartera_sap();');

-- 4. POLÍTICAS RLS PARA PERMITIR ACCESO CON ANON KEY DE LA PLATAFORMA
-- Ejecuta esto en Supabase si deseas que la aplicación web sincronice directamente con tu base de datos:
ALTER TABLE public.agentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones_cartera ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora_gestiones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura y escritura anon y auth agentes" ON public.agentes;
CREATE POLICY "Permitir lectura y escritura anon y auth agentes"
    ON public.agentes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir lectura y escritura anon y auth clientes" ON public.clientes;
CREATE POLICY "Permitir lectura y escritura anon y auth clientes"
    ON public.clientes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir lectura y escritura anon y auth bitacora" ON public.bitacora_gestiones;
CREATE POLICY "Permitir lectura y escritura anon y auth bitacora"
    ON public.bitacora_gestiones FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir lectura y escritura anon y auth asignaciones" ON public.asignaciones_cartera;
CREATE POLICY "Permitir lectura y escritura anon y auth asignaciones"
    ON public.asignaciones_cartera FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
