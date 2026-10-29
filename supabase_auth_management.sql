-- Supabase Auth + protected agent-profile management.
-- Apply this after the first administrator has been created in Supabase Auth.

BEGIN;

ALTER TABLE public.agentes
  ADD COLUMN IF NOT EXISTS extension_pbx TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS agentes_auth_id_unique
  ON public.agentes (auth_id)
  WHERE auth_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agentes
    WHERE auth_id = auth.uid()
      AND rol = 'admin'::public.rol_usuario
      AND estado = 'activo'::public.estado_agente
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated;

DO $$
DECLARE
  existing_policy RECORD;
BEGIN
  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agentes'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.agentes', existing_policy.policyname);
  END LOOP;
END;
$$;

ALTER TABLE public.agentes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentes FROM anon, authenticated;
GRANT SELECT ON public.agentes TO authenticated;

CREATE POLICY "agentes_read_self_or_admin"
  ON public.agentes
  FOR SELECT
  TO authenticated
  USING (
    (auth_id = auth.uid() AND estado = 'activo'::public.estado_agente)
    OR public.is_active_admin()
  );

COMMIT;

-- First-admin bootstrap (run separately after the migration):
-- 1) Create the administrator in Supabase Dashboard > Authentication > Users.
-- 2) Use a dedicated admin account (not one of the agents), replace the placeholders, then run:
--
-- DO $bootstrap$
-- DECLARE
--   admin_auth_id UUID;
--   admin_email TEXT := lower('ADMIN_EMAIL_HERE');
--   admin_name TEXT := 'ADMIN_NAME_HERE';
-- BEGIN
--   SELECT id INTO admin_auth_id FROM auth.users WHERE lower(email) = admin_email LIMIT 1;
--   IF admin_auth_id IS NULL THEN
--     RAISE EXCEPTION 'Create this administrator in Supabase Auth first.';
--   END IF;
--   IF EXISTS (
--     SELECT 1 FROM public.agentes
--     WHERE lower(email) = admin_email AND rol = 'agente'::public.rol_usuario
--   ) THEN
--     RAISE EXCEPTION 'Use a dedicated admin email, not an agent account.';
--   END IF;
--
--   UPDATE public.agentes
--   SET auth_id = admin_auth_id,
--       nombre = admin_name,
--       email = admin_email,
--       rol = 'admin'::public.rol_usuario,
--       estado = 'activo'::public.estado_agente,
--       updated_at = timezone('utc'::text, now())
--   WHERE lower(email) = admin_email
--     AND rol = 'admin'::public.rol_usuario;
--
--   IF NOT FOUND THEN
--     INSERT INTO public.agentes (auth_id, nombre, email, pais, rol, estado)
--     VALUES (
--       admin_auth_id, admin_name, admin_email,
--       'SV'::public.pais_code, 'admin'::public.rol_usuario, 'activo'::public.estado_agente
--     );
--   END IF;
-- END;
-- $bootstrap$;
