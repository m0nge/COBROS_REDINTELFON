-- Persist whether a client has any non-void SAN invoice issued in this month.
-- Agenda month M uses verified invoice flags from every month before M.
-- A NULL flag/timestamp means SAN data was unavailable or incomplete.
ALTER TABLE public.estado_cartera_mensual
  ADD COLUMN IF NOT EXISTS tiene_facturas_mes boolean,
  ADD COLUMN IF NOT EXISTS facturas_mes_verificado_en timestamptz;

CREATE INDEX IF NOT EXISTS estado_cartera_mensual_agenda_invoices_idx
  ON public.estado_cartera_mensual (
    pais,
    mes_periodo,
    facturas_mes_verificado_en,
    codigo_cliente
  )
  WHERE tiene_facturas_mes = true;
