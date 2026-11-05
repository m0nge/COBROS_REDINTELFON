-- Atomically update an existing collection management and keep payment state in sync.
-- Run after supabase_pago_realizado.sql has created estado_cartera_mensual and
-- added "Pago realizado" to public.tipo_acuerdo_tipo.

CREATE OR REPLACE FUNCTION public.update_management_record(
  p_record_id uuid,
  p_actor_id uuid,
  p_actor_is_admin boolean,
  p_tipo_gestion public.tipo_gestion_tipo,
  p_contacto_exitoso public.contacto_exitoso_tipo,
  p_acuerdo public.tipo_acuerdo_tipo,
  p_fecha_limite_pago date,
  p_monto_comprometido numeric,
  p_observaciones text,
  p_valores_dinamicos jsonb,
  p_duracion_llamada_segundos integer,
  p_validacion_exitosa boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_record public.bitacora_gestiones%ROWTYPE;
  v_client_code varchar;
  v_country public.pais_code;
  v_period_month varchar(7);
  v_other_payment_count integer;
  v_other_payment_amount numeric(14, 2);
BEGIN
  SELECT bg.*
    INTO v_record
  FROM public.bitacora_gestiones AS bg
  WHERE bg.id = p_record_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MANAGEMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  SELECT c.codigo, c.pais
    INTO v_client_code, v_country
  FROM public.clientes AS c
  WHERE c.id = v_record.cliente_id;
  IF NOT p_actor_is_admin AND v_record.agente_id <> p_actor_id THEN
    RAISE EXCEPTION 'MANAGEMENT_EDIT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_valores_dinamicos IS NULL OR jsonb_typeof(p_valores_dinamicos) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_MANAGEMENT_VALUES' USING ERRCODE = '22023';
  END IF;
  IF p_monto_comprometido < 0 OR p_duracion_llamada_segundos < 0 THEN
    RAISE EXCEPTION 'INVALID_MANAGEMENT_AMOUNT_OR_DURATION' USING ERRCODE = '22023';
  END IF;

  v_period_month := CASE
    WHEN v_record.acuerdo = 'Pago realizado'
      THEN v_record.valores_dinamicos->>'periodMonth'
    ELSE p_valores_dinamicos->>'periodMonth'
  END;
  IF p_acuerdo = 'Pago realizado' AND (
    v_period_month IS NULL
    OR v_period_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  ) THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_MONTH' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bitacora_gestiones
  SET tipo_gestion = p_tipo_gestion,
      contacto_exitoso = p_contacto_exitoso,
      acuerdo = p_acuerdo,
      fecha_limite_pago = p_fecha_limite_pago,
      monto_comprometido = p_monto_comprometido,
      observaciones = p_observaciones,
      valores_dinamicos = p_valores_dinamicos,
      duracion_llamada_segundos = p_duracion_llamada_segundos,
      validacion_exitosa = p_validacion_exitosa
  WHERE id = p_record_id;

  IF p_acuerdo = 'Pago realizado' THEN
    INSERT INTO public.estado_cartera_mensual (
      pais,
      codigo_cliente,
      mes_periodo,
      estado,
      monto_recuperado,
      verificado_en,
      updated_at
    ) VALUES (
      v_country,
      upper(trim(v_client_code)),
      v_period_month,
      'Resuelto',
      GREATEST(COALESCE((p_valores_dinamicos->>'paymentSanMonthAmount')::numeric, 0), 0),
      timezone('utc'::text, now()),
      timezone('utc'::text, now())
    )
    ON CONFLICT (pais, codigo_cliente, mes_periodo)
    DO UPDATE SET
      estado = 'Resuelto',
      monto_recuperado = GREATEST(EXCLUDED.monto_recuperado, 0),
      verificado_en = EXCLUDED.verificado_en,
      updated_at = EXCLUDED.updated_at;
  ELSIF v_record.acuerdo = 'Pago realizado' THEN
    SELECT
      count(*)::integer,
      COALESCE(sum(
        CASE
          WHEN COALESCE(bg.valores_dinamicos->>'periodMonth', bg.created_at::date::text) = v_period_month
            AND COALESCE(bg.valores_dinamicos->>'paymentSanMonthAmount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN (bg.valores_dinamicos->>'paymentSanMonthAmount')::numeric
          ELSE 0
        END
      ), 0)
    INTO v_other_payment_count, v_other_payment_amount
    FROM public.bitacora_gestiones AS bg
    WHERE bg.cliente_id = v_record.cliente_id
      AND bg.id <> p_record_id
      AND bg.acuerdo = 'Pago realizado'
      AND bg.validacion_exitosa = true
      AND COALESCE(bg.valores_dinamicos->>'periodMonth', bg.created_at::date::text) = v_period_month;

    INSERT INTO public.estado_cartera_mensual (
      pais,
      codigo_cliente,
      mes_periodo,
      estado,
      monto_recuperado,
      verificado_en,
      updated_at
    ) VALUES (
      v_country,
      upper(trim(v_client_code)),
      v_period_month,
      CASE WHEN v_other_payment_count > 0 THEN 'Resuelto'::public.estado_gestion_tipo ELSE 'Pendiente'::public.estado_gestion_tipo END,
      GREATEST(v_other_payment_amount, 0),
      timezone('utc'::text, now()),
      timezone('utc'::text, now())
    )
    ON CONFLICT (pais, codigo_cliente, mes_periodo)
    DO UPDATE SET
      estado = EXCLUDED.estado,
      monto_recuperado = EXCLUDED.monto_recuperado,
      verificado_en = EXCLUDED.verificado_en,
      updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN p_record_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_management_record(
  uuid, uuid, boolean, public.tipo_gestion_tipo, public.contacto_exitoso_tipo,
  public.tipo_acuerdo_tipo, date, numeric, text, jsonb, integer, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_management_record(
  uuid, uuid, boolean, public.tipo_gestion_tipo, public.contacto_exitoso_tipo,
  public.tipo_acuerdo_tipo, date, numeric, text, jsonb, integer, boolean
) TO service_role;
