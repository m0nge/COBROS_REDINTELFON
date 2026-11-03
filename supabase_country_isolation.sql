-- Country and fixed-portfolio isolation for SV and GT.
-- Run after the existing authentication, fixed-assignment, and contacts migrations.
-- API routes using the service role must still scope every request to the authenticated profile.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_agent_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
  SELECT a.id
  FROM public.agentes AS a
  WHERE a.auth_id = auth.uid()
    AND a.estado = 'activo'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_agent_country()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
  SELECT a.pais::text
  FROM public.agentes AS a
  WHERE a.auth_id = auth.uid()
    AND a.estado = 'activo'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_agent_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agentes AS a
    WHERE a.auth_id = auth.uid()
      AND a.estado = 'activo'
      AND a.rol = 'admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_client_in_country(
  requested_country text,
  requested_client_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agentes AS a
    WHERE a.auth_id = auth.uid()
      AND a.estado = 'activo'
      AND a.pais::text = requested_country
      AND (
        a.rol = 'admin'
        OR EXISTS (
          SELECT 1
          FROM public.asignaciones_cartera_fija AS f
          WHERE f.agente_id = a.id
            AND f.pais::text = requested_country
            AND upper(trim(f.codigo_cliente)) = upper(trim(requested_client_code))
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.current_agent_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_agent_country() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_agent_is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_client_in_country(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_agent_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_agent_country() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_agent_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_client_in_country(text, text) TO authenticated;

-- Replace any older global-admin or country-only policies on data-bearing tables.
DO $$
DECLARE
  target_table text;
  existing_policy record;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'agentes',
    'clientes',
    'asignaciones_cartera',
    'asignaciones_cartera_fija',
    'bitacora_gestiones',
    'servicios_cliente_san',
    'reclamos_cliente_san',
    'pagos_cliente_sap',
    'escalaciones_criticas',
    'contactos_cobros',
    'informacion_cobros_cliente',
    'contactos_cobros_import',
    'informacion_cobros_import',
    'estado_cartera_mensual'
  ]
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      CONTINUE;
    END IF;

    FOR existing_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', existing_policy.policyname, target_table);
    END LOOP;
  END LOOP;
END
$$;

ALTER TABLE public.agentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones_cartera ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones_cartera_fija ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora_gestiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servicios_cliente_san ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reclamos_cliente_san ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos_cliente_sap ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalaciones_criticas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contactos_cobros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.informacion_cobros_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contactos_cobros_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.informacion_cobros_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estado_cartera_mensual ENABLE ROW LEVEL SECURITY;

-- Authenticated clients can read, but all profile and assignment mutations go through
-- the authenticated server API with its service role and explicit country checks.
REVOKE ALL ON public.agentes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agentes TO authenticated;
CREATE POLICY agentes_read_own_market ON public.agentes
  FOR SELECT TO authenticated
  USING (
    (auth_id = auth.uid() AND id = public.current_agent_id())
    OR (public.current_agent_is_admin() AND pais::text = public.current_agent_country())
  );

REVOKE ALL ON public.clientes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.clientes TO authenticated;
CREATE POLICY clientes_read_assigned_market ON public.clientes
  FOR SELECT TO authenticated
  USING (public.can_access_client_in_country(pais::text, codigo::text));

REVOKE ALL ON public.asignaciones_cartera FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.asignaciones_cartera TO authenticated;
CREATE POLICY asignaciones_cartera_read_assigned_market ON public.asignaciones_cartera
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.clientes AS c
      WHERE c.id = cliente_id
        AND public.can_access_client_in_country(c.pais::text, c.codigo::text)
    )
  );

REVOKE ALL ON public.asignaciones_cartera_fija FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.asignaciones_cartera_fija TO authenticated;
CREATE POLICY asignaciones_fijas_read_own_market ON public.asignaciones_cartera_fija
  FOR SELECT TO authenticated
  USING (
    pais::text = public.current_agent_country()
    AND (public.current_agent_is_admin() OR agente_id = public.current_agent_id())
  );

REVOKE ALL ON public.bitacora_gestiones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.bitacora_gestiones TO authenticated;
CREATE POLICY bitacora_read_own_market ON public.bitacora_gestiones
  FOR SELECT TO authenticated
  USING (
    (public.current_agent_is_admin() OR agente_id = public.current_agent_id())
    AND EXISTS (
      SELECT 1
      FROM public.clientes AS c
      WHERE c.id = cliente_id
        AND public.can_access_client_in_country(c.pais::text, c.codigo::text)
    )
  );
CREATE POLICY bitacora_insert_own_market ON public.bitacora_gestiones
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.clientes AS c
      WHERE c.id = cliente_id
        AND public.can_access_client_in_country(c.pais::text, c.codigo::text)
    )
    AND EXISTS (
      SELECT 1
      FROM public.agentes AS a
      WHERE a.id = agente_id
        AND a.pais::text = public.current_agent_country()
        AND (public.current_agent_is_admin() OR a.id = public.current_agent_id())
    )
    AND (
      asignacion_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.asignaciones_cartera AS ca
        WHERE ca.id = asignacion_id
          AND ca.cliente_id = cliente_id
          AND ca.agente_id = agente_id
      )
    )
  );

REVOKE ALL ON public.servicios_cliente_san FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.servicios_cliente_san TO authenticated;
CREATE POLICY servicios_cliente_read_assigned_market ON public.servicios_cliente_san
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clientes AS c
      WHERE c.id = cliente_id
        AND public.can_access_client_in_country(c.pais::text, c.codigo::text)
    )
  );

REVOKE ALL ON public.reclamos_cliente_san FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reclamos_cliente_san TO authenticated;
CREATE POLICY reclamos_cliente_read_assigned_market ON public.reclamos_cliente_san
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clientes AS c
      WHERE c.id = cliente_id
        AND public.can_access_client_in_country(c.pais::text, c.codigo::text)
    )
  );

REVOKE ALL ON public.pagos_cliente_sap FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pagos_cliente_sap TO authenticated;
CREATE POLICY pagos_cliente_read_assigned_market ON public.pagos_cliente_sap
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clientes AS c
      WHERE c.id = cliente_id
        AND public.can_access_client_in_country(c.pais::text, c.codigo::text)
    )
  );

REVOKE ALL ON public.escalaciones_criticas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.escalaciones_criticas TO authenticated;
CREATE POLICY escalaciones_read_own_market ON public.escalaciones_criticas
  FOR SELECT TO authenticated
  USING (
    (public.current_agent_is_admin() OR agente_id = public.current_agent_id())
    AND EXISTS (
      SELECT 1 FROM public.clientes AS c
      WHERE c.id = cliente_id
        AND public.can_access_client_in_country(c.pais::text, c.codigo::text)
    )
  );

REVOKE ALL ON public.contactos_cobros FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contactos_cobros TO authenticated;
CREATE POLICY contactos_cobros_read_assigned_market ON public.contactos_cobros
  FOR SELECT TO authenticated
  USING (public.can_access_client_in_country(pais::text, codigo_cliente::text));

REVOKE ALL ON public.informacion_cobros_cliente FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.informacion_cobros_cliente TO authenticated;
CREATE POLICY informacion_cobros_read_assigned_market ON public.informacion_cobros_cliente
  FOR SELECT TO authenticated
  USING (public.can_access_client_in_country(pais::text, codigo_cliente::text));

-- Staging/import data and monthly reconciliation are server-only (service role).
REVOKE ALL ON public.contactos_cobros_import FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.informacion_cobros_import FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.estado_cartera_mensual FROM PUBLIC, anon, authenticated;

COMMIT;
