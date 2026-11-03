-- Permite asignar CL000610 a ambas agentes de Guatemala sin alterar
-- las demás asignaciones. Ejecutar una sola vez en Supabase SQL Editor.
BEGIN;

DO $$
DECLARE
  v_client_id uuid;
  v_agent_count integer;
  v_inserted integer;
  v_constraint record;
  v_index record;
BEGIN
  SELECT id
    INTO v_client_id
    FROM public.clientes
   WHERE pais = 'GT'
     AND upper(trim(codigo)) = 'CL000610'
   LIMIT 1;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró CL000610 en public.clientes para GT.';
  END IF;

  SELECT count(DISTINCT id)
    INTO v_agent_count
    FROM public.agentes
   WHERE pais = 'GT'
     AND lower(trim(email)) IN ('mfsandoval@red.com.gt', 'kreyna@red.com.gt')
      AND lower(rol::text) = 'agente';

  IF v_agent_count <> 2 THEN
    RAISE EXCEPTION 'Se esperaban los dos perfiles GT (MSANDOVAL y KREYNA); se encontraron %.', v_agent_count;
  END IF;

  -- Si la tabla impide compartir por tener unicidad solo por cliente,
  -- reemplaza esa restricción para que un código pueda tener dos agentes.
  FOR v_constraint IN
    SELECT conname
      FROM pg_constraint c
     WHERE conrelid = 'public.asignaciones_cartera_fija'::regclass
       AND contype IN ('p', 'u')
       AND ARRAY(
         SELECT a.attname::text
           FROM unnest(c.conkey) AS key(attnum)
           JOIN pg_attribute a
             ON a.attrelid = c.conrelid
            AND a.attnum = key.attnum
          ORDER BY a.attname::text
       ) = ARRAY['codigo_cliente', 'pais']::text[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.asignaciones_cartera_fija DROP CONSTRAINT %I',
      v_constraint.conname
    );
  END LOOP;

  FOR v_index IN
    SELECT ns.nspname AS schema_name, idx.relname AS index_name
      FROM pg_index i
      JOIN pg_class tbl ON tbl.oid = i.indrelid
      JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
      JOIN pg_class idx ON idx.oid = i.indexrelid
      JOIN pg_namespace ns ON ns.oid = idx.relnamespace
     WHERE tbl_ns.nspname = 'public'
       AND tbl.relname = 'asignaciones_cartera_fija'
       AND i.indisunique
       AND NOT EXISTS (
         SELECT 1
           FROM pg_constraint c
          WHERE c.conindid = i.indexrelid
       )
       AND ARRAY(
         SELECT a.attname::text
           FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ordinality)
           JOIN pg_attribute a
             ON a.attrelid = i.indrelid
            AND a.attnum = key.attnum
          WHERE key.ordinality <= i.indnkeyatts
          ORDER BY a.attname::text
       ) = ARRAY['codigo_cliente', 'pais']::text[]
  LOOP
    EXECUTE format(
      'DROP INDEX %I.%I',
      v_index.schema_name,
      v_index.index_name
    );
  END LOOP;

  INSERT INTO public.asignaciones_cartera_fija
    (pais, codigo_cliente, cliente_id, agente_id, source_sheet)
  SELECT
    'GT',
    'CL000610',
    v_client_id,
    a.id,
    'GT'
    FROM public.agentes a
   WHERE a.pais = 'GT'
     AND lower(trim(a.email)) IN ('mfsandoval@red.com.gt', 'kreyna@red.com.gt')
      AND lower(a.rol::text) = 'agente'
     AND NOT EXISTS (
       SELECT 1
         FROM public.asignaciones_cartera_fija existing
        WHERE existing.pais = 'GT'
          AND upper(trim(existing.codigo_cliente)) = 'CL000610'
          AND existing.agente_id = a.id
     );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF (
    SELECT count(DISTINCT agente_id)
      FROM public.asignaciones_cartera_fija
     WHERE pais = 'GT'
       AND upper(trim(codigo_cliente)) = 'CL000610'
       AND agente_id IN (
         SELECT id
           FROM public.agentes
          WHERE pais = 'GT'
            AND lower(trim(email)) IN ('mfsandoval@red.com.gt', 'kreyna@red.com.gt')
       )
  ) <> 2 THEN
    RAISE EXCEPTION 'CL000610 no quedó asignado a ambas agentes; se revierte la operación.';
  END IF;

  RAISE NOTICE 'Asignaciones compartidas confirmadas. Filas nuevas: %.', v_inserted;
END
$$;

COMMIT;

SELECT
  a.pais,
  a.codigo_cliente,
  g.nombre AS agente,
  g.email
FROM public.asignaciones_cartera_fija a
JOIN public.agentes g ON g.id = a.agente_id
WHERE a.pais = 'GT'
  AND upper(trim(a.codigo_cliente)) = 'CL000610'
  AND lower(trim(g.email)) IN ('mfsandoval@red.com.gt', 'kreyna@red.com.gt')
ORDER BY g.email;
