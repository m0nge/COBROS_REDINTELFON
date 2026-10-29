-- Persist month-specific recovery state without carrying "Resuelto" into a later month.
CREATE TABLE IF NOT EXISTS public.estado_cartera_mensual (
  pais public.pais_code NOT NULL,
  codigo_cliente character varying NOT NULL,
  mes_periodo character varying(7) NOT NULL
    CHECK (mes_periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  estado public.estado_gestion_tipo NOT NULL DEFAULT 'Pendiente',
  monto_recuperado numeric(14, 2) NOT NULL DEFAULT 0,
  verificado_en timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT estado_cartera_mensual_pk PRIMARY KEY (pais, codigo_cliente, mes_periodo)
);

CREATE INDEX IF NOT EXISTS estado_cartera_mensual_mes_idx
  ON public.estado_cartera_mensual (mes_periodo, pais, estado);

ALTER TABLE public.estado_cartera_mensual ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.estado_cartera_mensual FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.estado_cartera_mensual TO service_role;
