-- Contactos y reglas de cobro importados desde las hojas SV y GT.
-- Ejecutar primero en Supabase SQL Editor. Después importar los CSV de staging
-- con Table Editor y ejecutar la sección "Promoción de datos validados".

BEGIN;

-- La plantilla usa códigos que pueden repetirse entre países para clientes
-- distintos. Reemplazamos UNIQUE(codigo) por UNIQUE(codigo, pais), sin borrar datos.
DO $$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.clientes'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (codigo)'
  LOOP
    EXECUTE format('ALTER TABLE public.clientes DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.clientes'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (codigo, pais)'
  ) THEN
    EXECUTE 'ALTER TABLE public.clientes
      ADD CONSTRAINT clientes_codigo_pais_key UNIQUE (codigo, pais)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.contactos_cobros (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_cliente VARCHAR(30) NOT NULL,
  pais public.pais_code NOT NULL,
  numero_contacto SMALLINT NOT NULL CHECK (numero_contacto > 0),
  nombre TEXT,
  cargo TEXT,
  telefono_fijo TEXT,
  correo TEXT,
  whatsapp TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT contactos_cobros_cliente_fk
    FOREIGN KEY (codigo_cliente, pais)
    REFERENCES public.clientes (codigo, pais)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT contactos_cobros_contacto_unico
    UNIQUE (codigo_cliente, pais, numero_contacto),
  CONSTRAINT contactos_cobros_nombre_minimo
    CHECK (
      nombre IS NULL
      OR char_length(regexp_replace(nombre, '[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]', '', 'g')) >= 6
    ),
  CONSTRAINT contactos_cobros_telefono_minimo
    CHECK (
      telefono_fijo IS NULL
      OR char_length(regexp_replace(telefono_fijo, '[^0-9]', '', 'g')) >= 8
    ),
  CONSTRAINT contactos_cobros_whatsapp_minimo
    CHECK (
      whatsapp IS NULL
      OR char_length(regexp_replace(whatsapp, '[^0-9]', '', 'g')) >= 8
    ),
  CONSTRAINT contactos_cobros_correo_valido
    CHECK (
      correo IS NULL
      OR correo ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    )
);

CREATE TABLE IF NOT EXISTS public.informacion_cobros_cliente (
  codigo_cliente VARCHAR(30) NOT NULL,
  pais public.pais_code NOT NULL,
  entrega_quedan BOOLEAN,
  exige_factura_fisica BOOLEAN,
  procedimientos_cobro TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT informacion_cobros_cliente_pk PRIMARY KEY (codigo_cliente, pais),
  CONSTRAINT informacion_cobros_cliente_fk
    FOREIGN KEY (codigo_cliente, pais)
    REFERENCES public.clientes (codigo, pais)
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- Tablas privadas de staging: los CSV conservan filas que necesitan revisión.
CREATE TABLE IF NOT EXISTS public.contactos_cobros_import (
  source_sheet TEXT,
  source_row INTEGER,
  pais TEXT,
  codigo_cliente TEXT,
  numero_contacto INTEGER,
  nombre TEXT,
  cargo TEXT,
  telefono_fijo TEXT,
  correo TEXT,
  whatsapp TEXT
);

CREATE TABLE IF NOT EXISTS public.informacion_cobros_import (
  source_sheet TEXT,
  source_row INTEGER,
  pais TEXT,
  codigo_cliente TEXT,
  entrega_quedan TEXT,
  exige_factura_fisica TEXT,
  procedimiento_cobros TEXT
);

CREATE INDEX IF NOT EXISTS idx_contactos_cobros_cliente
  ON public.contactos_cobros (pais, codigo_cliente);

ALTER TABLE public.contactos_cobros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.informacion_cobros_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contactos_cobros_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.informacion_cobros_import ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura contactos de cobro por país" ON public.contactos_cobros;
CREATE POLICY "Lectura contactos de cobro por país"
  ON public.contactos_cobros
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.agentes a
      WHERE a.auth_id = auth.uid()
        AND (a.rol = 'admin' OR a.pais = contactos_cobros.pais)
    )
  );

DROP POLICY IF EXISTS "Lectura información de cobro por país" ON public.informacion_cobros_cliente;
CREATE POLICY "Lectura información de cobro por país"
  ON public.informacion_cobros_cliente
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.agentes a
      WHERE a.auth_id = auth.uid()
        AND (a.rol = 'admin' OR a.pais = informacion_cobros_cliente.pais)
    )
  );

REVOKE ALL ON public.contactos_cobros_import FROM anon, authenticated;
REVOKE ALL ON public.informacion_cobros_import FROM anon, authenticated;
REVOKE ALL ON public.contactos_cobros FROM anon;
REVOKE ALL ON public.informacion_cobros_cliente FROM anon;
GRANT SELECT ON public.contactos_cobros TO authenticated;
GRANT SELECT ON public.informacion_cobros_cliente TO authenticated;

COMMIT;

-- IMPORTACIÓN
-- 1) Importa contactos_cobros_import.csv en public.contactos_cobros_import.
-- 2) Importa configuracion_cobros_import.csv en public.informacion_cobros_import.
-- 3) Ejecuta las consultas de validación; luego ejecuta las dos inserciones.

-- Validación de contactos. Los valores vacíos son nulos permitidos.
WITH source_rows AS (
  SELECT
    s.*,
    NULLIF(BTRIM(s.nombre), '') AS nombre_limpio,
    NULLIF(BTRIM(s.telefono_fijo), '') AS telefono_limpio,
    NULLIF(BTRIM(s.whatsapp), '') AS whatsapp_limpio,
    NULLIF(BTRIM(s.correo), '') AS correo_limpio,
    CASE WHEN UPPER(BTRIM(s.pais)) IN ('SV', 'GT')
      THEN UPPER(BTRIM(s.pais))::public.pais_code
    END AS pais_codigo
  FROM public.contactos_cobros_import s
)
SELECT
  COUNT(*) AS filas_importadas,
  COUNT(*) FILTER (WHERE c.id IS NULL) AS codigo_pais_no_encontrado_en_clientes,
  COUNT(*) FILTER (
    WHERE nombre_limpio IS NOT NULL
      AND char_length(regexp_replace(nombre_limpio, '[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]', '', 'g')) < 6
  ) AS nombres_con_menos_de_6_letras,
  COUNT(*) FILTER (
    WHERE correo_limpio IS NOT NULL
      AND correo_limpio !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) AS correos_invalidos,
  COUNT(*) FILTER (
    WHERE (telefono_limpio IS NOT NULL
      AND char_length(regexp_replace(telefono_limpio, '[^0-9]', '', 'g')) < 8)
       OR (whatsapp_limpio IS NOT NULL
      AND char_length(regexp_replace(whatsapp_limpio, '[^0-9]', '', 'g')) < 8)
  ) AS telefonos_con_menos_de_8_digitos,
  COUNT(*) FILTER (WHERE numero_contacto IS NULL OR numero_contacto < 1) AS numeros_de_contacto_invalidos
FROM source_rows s
LEFT JOIN public.clientes c
  ON c.codigo = NULLIF(BTRIM(s.codigo_cliente), '')
 AND c.pais = s.pais_codigo;

-- Promueve solo contactos que cumplen las reglas y tienen código-país existente.
INSERT INTO public.contactos_cobros (
  codigo_cliente, pais, numero_contacto, nombre, cargo,
  telefono_fijo, correo, whatsapp, updated_at
)
SELECT
  BTRIM(s.codigo_cliente),
  UPPER(BTRIM(s.pais))::public.pais_code,
  s.numero_contacto::SMALLINT,
  NULLIF(BTRIM(s.nombre), ''),
  NULLIF(BTRIM(s.cargo), ''),
  NULLIF(BTRIM(s.telefono_fijo), ''),
  NULLIF(BTRIM(s.correo), ''),
  NULLIF(BTRIM(s.whatsapp), ''),
  timezone('utc'::text, now())
FROM public.contactos_cobros_import s
JOIN public.clientes c
  ON c.codigo = BTRIM(s.codigo_cliente)
 AND c.pais = UPPER(BTRIM(s.pais))::public.pais_code
WHERE UPPER(BTRIM(s.pais)) IN ('SV', 'GT')
  AND s.numero_contacto BETWEEN 1 AND 32767
  AND (
    NULLIF(BTRIM(s.nombre), '') IS NULL
    OR char_length(regexp_replace(BTRIM(s.nombre), '[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]', '', 'g')) >= 6
  )
  AND (
    NULLIF(BTRIM(s.telefono_fijo), '') IS NULL
    OR char_length(regexp_replace(BTRIM(s.telefono_fijo), '[^0-9]', '', 'g')) >= 8
  )
  AND (
    NULLIF(BTRIM(s.whatsapp), '') IS NULL
    OR char_length(regexp_replace(BTRIM(s.whatsapp), '[^0-9]', '', 'g')) >= 8
  )
  AND (
    NULLIF(BTRIM(s.correo), '') IS NULL
    OR BTRIM(s.correo) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  )
ON CONFLICT (codigo_cliente, pais, numero_contacto) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  cargo = EXCLUDED.cargo,
  telefono_fijo = EXCLUDED.telefono_fijo,
  correo = EXCLUDED.correo,
  whatsapp = EXCLUDED.whatsapp,
  updated_at = timezone('utc'::text, now());

-- Resumen de valores distintos en las reglas booleanas antes de promoverlas.
WITH parsed AS (
  SELECT
    UPPER(BTRIM(pais)) AS pais,
    BTRIM(codigo_cliente) AS codigo_cliente,
    CASE
      WHEN LOWER(BTRIM(entrega_quedan)) IN ('si', 'sí', 'true', '1', 'yes') THEN TRUE
      WHEN LOWER(BTRIM(entrega_quedan)) IN ('no', 'false', '0') THEN FALSE
      ELSE NULL
    END AS entrega_quedan,
    CASE
      WHEN LOWER(BTRIM(exige_factura_fisica)) IN ('si', 'sí', 'true', '1', 'yes') THEN TRUE
      WHEN LOWER(BTRIM(exige_factura_fisica)) IN ('no', 'false', '0') THEN FALSE
      ELSE NULL
    END AS exige_factura_fisica
  FROM public.informacion_cobros_import
  WHERE UPPER(BTRIM(pais)) IN ('SV', 'GT')
    AND NULLIF(BTRIM(codigo_cliente), '') IS NOT NULL
)
SELECT pais, codigo_cliente
FROM parsed
GROUP BY pais, codigo_cliente
HAVING COUNT(DISTINCT entrega_quedan) > 1
    OR COUNT(DISTINCT exige_factura_fisica) > 1;

-- Promueve reglas por cliente; procedimientos repetidos en la hoja se conservan
-- como una lista única en vez de duplicar la ficha del cliente.
WITH parsed AS (
  SELECT
    UPPER(BTRIM(s.pais))::public.pais_code AS pais,
    BTRIM(s.codigo_cliente) AS codigo_cliente,
    CASE
      WHEN LOWER(BTRIM(s.entrega_quedan)) IN ('si', 'sí', 'true', '1', 'yes') THEN TRUE
      WHEN LOWER(BTRIM(s.entrega_quedan)) IN ('no', 'false', '0') THEN FALSE
      ELSE NULL
    END AS entrega_quedan,
    CASE
      WHEN LOWER(BTRIM(s.exige_factura_fisica)) IN ('si', 'sí', 'true', '1', 'yes') THEN TRUE
      WHEN LOWER(BTRIM(s.exige_factura_fisica)) IN ('no', 'false', '0') THEN FALSE
      ELSE NULL
    END AS exige_factura_fisica,
    NULLIF(BTRIM(s.procedimiento_cobros), '') AS procedimiento
  FROM public.informacion_cobros_import s
  WHERE UPPER(BTRIM(s.pais)) IN ('SV', 'GT')
    AND NULLIF(BTRIM(s.codigo_cliente), '') IS NOT NULL
),
grouped AS (
  SELECT
    pais,
    codigo_cliente,
    BOOL_OR(entrega_quedan) AS entrega_quedan,
    BOOL_OR(exige_factura_fisica) AS exige_factura_fisica,
    COALESCE(
      ARRAY_AGG(DISTINCT procedimiento) FILTER (WHERE procedimiento IS NOT NULL),
      ARRAY[]::TEXT[]
    ) AS procedimientos_cobro
  FROM parsed
  GROUP BY pais, codigo_cliente
  HAVING COUNT(DISTINCT entrega_quedan) <= 1
     AND COUNT(DISTINCT exige_factura_fisica) <= 1
)
INSERT INTO public.informacion_cobros_cliente (
  codigo_cliente, pais, entrega_quedan, exige_factura_fisica,
  procedimientos_cobro, updated_at
)
SELECT
  g.codigo_cliente, g.pais, g.entrega_quedan, g.exige_factura_fisica,
  g.procedimientos_cobro, timezone('utc'::text, now())
FROM grouped g
JOIN public.clientes c
  ON c.codigo = g.codigo_cliente
 AND c.pais = g.pais
ON CONFLICT (codigo_cliente, pais) DO UPDATE SET
  entrega_quedan = EXCLUDED.entrega_quedan,
  exige_factura_fisica = EXCLUDED.exige_factura_fisica,
  procedimientos_cobro = EXCLUDED.procedimientos_cobro,
  updated_at = timezone('utc'::text, now());
