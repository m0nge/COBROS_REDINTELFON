-- Migration for mandatory payment receipts and atomic monthly payment resolution.
-- Run once in Supabase SQL Editor after the existing schema and country-isolation SQL.

ALTER TYPE public.tipo_acuerdo_tipo ADD VALUE IF NOT EXISTS 'Pago realizado';

CREATE TABLE IF NOT EXISTS public.estado_cartera_mensual (
  pais public.pais_code NOT NULL,
  codigo_cliente character varying NOT NULL,
  mes_periodo character varying(7) NOT NULL
    CHECK (mes_periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  estado public.estado_gestion_tipo NOT NULL DEFAULT 'Pendiente',
  monto_recuperado numeric(14, 2) NOT NULL DEFAULT 0,
  verificado_en timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT estado_cartera_mensual_pk PRIMARY KEY (pais, codigo_cliente, mes_periodo)
);
ALTER TABLE public.estado_cartera_mensual ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.estado_cartera_mensual FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.estado_cartera_mensual TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comprobantes-pago',
  'comprobantes-pago',
  false,
  52428800,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "payment_receipts_agent_upload" ON storage.objects;
CREATE POLICY "payment_receipts_agent_upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'comprobantes-pago'
  AND public.can_access_client_in_country(
    split_part(name, '/', 1),
    split_part(name, '/', 2)
  )
  AND split_part(name, '/', 3) = public.current_agent_id()::text
  AND cardinality(storage.foldername(name)) = 3
);

DROP POLICY IF EXISTS "payment_receipts_agent_cleanup" ON storage.objects;
CREATE POLICY "payment_receipts_agent_cleanup"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'comprobantes-pago'
  AND public.can_access_client_in_country(
    split_part(name, '/', 1),
    split_part(name, '/', 2)
  )
  AND split_part(name, '/', 3) = public.current_agent_id()::text
  AND cardinality(storage.foldername(name)) = 3
);

DROP POLICY IF EXISTS "payment_receipts_admin_read" ON storage.objects;
CREATE POLICY "payment_receipts_admin_read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'comprobantes-pago'
  AND public.current_agent_is_admin()
  AND split_part(name, '/', 1) = public.current_agent_country()
);

-- Payment details and receipt paths are only visible in the admin audit.
-- Remove the broad legacy policy created by the original schema and keep
-- the country-scoped policy while hiding payment rows from non-admin agents.
DROP POLICY IF EXISTS "Gestiones permitidas por agente asignado" ON public.bitacora_gestiones;
DROP POLICY IF EXISTS bitacora_read_own_market ON public.bitacora_gestiones;
CREATE POLICY bitacora_read_own_market ON public.bitacora_gestiones
  FOR SELECT TO authenticated
  USING (
    (
      public.current_agent_is_admin()
      OR (
        agente_id = public.current_agent_id()
        AND acuerdo::text <> 'Pago realizado'
      )
    )
    AND EXISTS (
      SELECT 1
      FROM public.clientes AS c
      WHERE c.id = cliente_id
        AND public.can_access_client_in_country(c.pais::text, c.codigo::text)
    )
  );

CREATE OR REPLACE FUNCTION public.register_payment_management(
  p_cliente_id uuid,
  p_agente_id uuid,
  p_tipo_gestion public.tipo_gestion_tipo,
  p_observaciones text,
  p_valores_dinamicos jsonb,
  p_pais public.pais_code,
  p_codigo_cliente character varying,
  p_mes_periodo character varying,
  p_monto_recuperado numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_record_id uuid;
BEGIN
  IF p_mes_periodo !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_MONTH';
  END IF;

  INSERT INTO public.bitacora_gestiones (
    cliente_id,
    agente_id,
    tipo_gestion,
    contacto_exitoso,
    acuerdo,
    fecha_limite_pago,
    monto_comprometido,
    observaciones,
    valores_dinamicos,
    validacion_exitosa
  ) VALUES (
    p_cliente_id,
    p_agente_id,
    p_tipo_gestion,
    'Si',
    'Pago realizado',
    NULL,
    0,
    p_observaciones,
    COALESCE(p_valores_dinamicos, '{}'::jsonb),
    true
  )
  RETURNING id INTO v_record_id;

  INSERT INTO public.estado_cartera_mensual (
    pais,
    codigo_cliente,
    mes_periodo,
    estado,
    monto_recuperado,
    verificado_en,
    updated_at
  ) VALUES (
    p_pais,
    upper(trim(p_codigo_cliente)),
    p_mes_periodo,
    'Resuelto',
    GREATEST(COALESCE(p_monto_recuperado, 0), 0),
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
  )
  ON CONFLICT (pais, codigo_cliente, mes_periodo)
  DO UPDATE SET
    estado = 'Resuelto',
    monto_recuperado = GREATEST(EXCLUDED.monto_recuperado, 0),
    verificado_en = EXCLUDED.verificado_en,
    updated_at = EXCLUDED.updated_at;

  RETURN v_record_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_payment_management(
  uuid, uuid, public.tipo_gestion_tipo, text, jsonb, public.pais_code,
  character varying, character varying, numeric
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_payment_management(
  uuid, uuid, public.tipo_gestion_tipo, text, jsonb, public.pais_code,
  character varying, character varying, numeric
) TO service_role;
