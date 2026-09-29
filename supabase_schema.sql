-- ==============================================================================
-- SCHEMA SUPABASE: SISTEMA INTELIGENTE DE COBRANZAS Y GESTIÓN DE CARTERA RED
-- Compatible con PostgreSQL 15+ / Supabase
-- El Salvador (SV) y Guatemala (GT)
-- ==============================================================================

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TIPOS ENUMERADOS
DO $$ BEGIN
    CREATE TYPE pais_code AS ENUM ('SV', 'GT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE rol_usuario AS ENUM ('admin', 'agente');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE estado_agente AS ENUM ('activo', 'inactivo', 'en_pausa');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE rango_mora_tipo AS ENUM ('0-30', '31-60', '61-90', '91-120', '120+');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE estado_gestion_tipo AS ENUM ('Pendiente', 'No Contactado', 'Resuelto', 'Escalado');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE tipo_gestion_tipo AS ENUM ('Llamada', 'WhatsApp', 'Email', 'Visita');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE contacto_exitoso_tipo AS ENUM ('Si', 'No', 'Sin respuesta');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE tipo_acuerdo_tipo AS ENUM ('Promesa de Pago', 'Negociación de Cuotas', 'Sin Acuerdo', 'Disputa de Factura', 'No Aplica');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. TABLA DE AGENTES DE COBRO Y ADMINISTRADORES
CREATE TABLE IF NOT EXISTS public.agentes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    nombre VARCHAR(120) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    telefono VARCHAR(30),
    pais pais_code NOT NULL DEFAULT 'SV',
    rol rol_usuario NOT NULL DEFAULT 'agente',
    estado estado_agente NOT NULL DEFAULT 'activo',
    avatar_url TEXT,
    tasa_efectividad NUMERIC(5,2) DEFAULT 85.00,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. TABLA DE CLIENTES (SAP & CARTERA VIGENTE)
CREATE TABLE IF NOT EXISTS public.clientes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo VARCHAR(30) UNIQUE NOT NULL, -- ej: CL000002
    nombre VARCHAR(255) NOT NULL,
    direccion TEXT,
    phone1 VARCHAR(40),
    phone2 VARCHAR(40),
    celular VARCHAR(40),
    departamento VARCHAR(100),
    municipio VARCHAR(100),
    correo VARCHAR(150),
    clasificacion VARCHAR(80), -- 'PERSONA JURIDICA', 'GOBIERNO', etc.
    gestor_comercial VARCHAR(120),
    email_gestor VARCHAR(150),
    codigo_gestor VARCHAR(30),
    pais pais_code NOT NULL DEFAULT 'SV',
    total_deuda NUMERIC(12,2) DEFAULT 0.00,
    dias_mora INTEGER DEFAULT 0,
    rango_mora rango_mora_tipo DEFAULT '0-30',
    estado_gestion estado_gestion_tipo DEFAULT 'Pendiente',
    prioridad VARCHAR(20) DEFAULT 'Media', -- 'Alta', 'Media', 'Normal'
    fecha_emision_factura DATE,
    fecha_limite_pago DATE,
    ultima_gestion_fecha TIMESTAMPTZ,
    ultima_gestion_tipo tipo_gestion_tipo,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. TABLA DE ASIGNACIONES MENSUALES Y AGENDA DIARIA
-- Reparto equitativo por mes y distribución de Lunes a Viernes (8:00 AM - 6:00 PM)
CREATE TABLE IF NOT EXISTS public.asignaciones_cartera (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mes_periodo VARCHAR(7) NOT NULL, -- '2026-10'
    agente_id UUID NOT NULL REFERENCES public.agentes(id) ON DELETE CASCADE,
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    fecha_agenda DATE NOT NULL,
    hora_bloque TIME NOT NULL, -- e.g. 08:30:00
    dia_semana VARCHAR(15), -- 'Lunes', 'Martes', etc.
    orden_turno INTEGER DEFAULT 1,
    estado estado_gestion_tipo DEFAULT 'Pendiente',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(mes_periodo, cliente_id)
);

-- 6. TABLA DE CONFIGURACIÓN DEL FORMULARIO DINÁMICO DE BITÁCORA
CREATE TABLE IF NOT EXISTS public.campos_formulario_dinamico (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre_campo VARCHAR(80) NOT NULL,
    etiqueta VARCHAR(120) NOT NULL,
    tipo_campo VARCHAR(30) NOT NULL, -- 'text', 'dropdown', 'checkbox', 'datepicker'
    opciones TEXT[], -- opciones para dropdowns o checkboxes
    es_obligatorio BOOLEAN DEFAULT false,
    orden INTEGER DEFAULT 1,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. TABLA DE BITÁCORA DE GESTIÓN Y CIERRE DE ACUERDOS
CREATE TABLE IF NOT EXISTS public.bitacora_gestiones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asignacion_id UUID REFERENCES public.asignaciones_cartera(id) ON DELETE SET NULL,
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    agente_id UUID NOT NULL REFERENCES public.agentes(id) ON DELETE CASCADE,
    tipo_gestion tipo_gestion_tipo NOT NULL DEFAULT 'Llamada',
    contacto_exitoso contacto_exitoso_tipo NOT NULL DEFAULT 'Si',
    acuerdo tipo_acuerdo_tipo NOT NULL DEFAULT 'Promesa de Pago',
    duracion_llamada_segundos INTEGER DEFAULT 45,
    fecha_limite_pago DATE,
    monto_comprometido NUMERIC(12,2) DEFAULT 0.00,
    observaciones TEXT,
    grabacion_audio_url TEXT,
    grabacion_duracion VARCHAR(20) DEFAULT '03:45',
    valores_dinamicos JSONB DEFAULT '{}'::jsonb,
    validacion_llamada_30s BOOLEAN DEFAULT true,
    validacion_campos_completos BOOLEAN DEFAULT true,
    validacion_acuerdo_valido BOOLEAN DEFAULT true,
    validacion_exitosa BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. TABLA DE HISTÓRICO Y RECLAMOS CLIENTE 360 (SAN)
CREATE TABLE IF NOT EXISTS public.servicios_cliente_san (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    nombre_servicio VARCHAR(100) NOT NULL, -- 'Internet Fibra', 'TV Digital', etc.
    icono VARCHAR(50),
    estado VARCHAR(30) DEFAULT 'Activo'
);

CREATE TABLE IF NOT EXISTS public.reclamos_cliente_san (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    motivo VARCHAR(200) NOT NULL,
    estado VARCHAR(40) DEFAULT 'Pendiente' -- 'Pendiente', 'Resuelto', 'En Proceso'
);

CREATE TABLE IF NOT EXISTS public.pagos_cliente_sap (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    fecha_pago DATE NOT NULL,
    monto NUMERIC(12,2) NOT NULL,
    tipo_pago VARCHAR(20) NOT NULL DEFAULT 'Parcial' -- 'Parcial', 'Completo'
);

-- 9. TABLA DE CLIENTES CRÍTICOS ESCALADOS (120+ DÍAS)
CREATE TABLE IF NOT EXISTS public.escalaciones_criticas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    agente_id UUID REFERENCES public.agentes(id) ON DELETE SET NULL,
    monto_deuda NUMERIC(12,2) NOT NULL,
    dias_mora INTEGER NOT NULL,
    departamento_destino VARCHAR(60) DEFAULT 'Cobranza Judicial / Legal',
    motivo TEXT,
    estado VARCHAR(40) DEFAULT 'Escalado',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 10. FUNCIONES Y TRIGGERS DE NEGOCIO

-- A) Clasificación automática de mora:
-- 0-30: No moroso (Período normal)
-- 31-60: Primer contacto (Gestión preventiva)
-- 61-90: Segundo contacto (Seguimiento moderado)
-- 91-120: Tercer contacto (Urgencia)
-- 120+: Crítico (Requiere escalación inmediata)
CREATE OR REPLACE FUNCTION calcular_clasificacion_mora()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.dias_mora <= 30 THEN
        NEW.rango_mora := '0-30';
    ELSIF NEW.dias_mora <= 60 THEN
        NEW.rango_mora := '31-60';
    ELSIF NEW.dias_mora <= 90 THEN
        NEW.rango_mora := '61-90';
    ELSIF NEW.dias_mora <= 120 THEN
        NEW.rango_mora := '91-120';
    ELSE
        NEW.rango_mora := '120+';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calcular_mora ON public.clientes;
CREATE TRIGGER trg_calcular_mora
BEFORE INSERT OR UPDATE OF dias_mora ON public.clientes
FOR EACH ROW EXECUTE FUNCTION calcular_clasificacion_mora();

-- B) Actualización de cliente tras registrar gestión validada
CREATE OR REPLACE FUNCTION actualizar_estado_tras_gestion()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.validacion_exitosa = true THEN
        UPDATE public.clientes
        SET estado_gestion = 'Resuelto',
            ultima_gestion_fecha = NEW.created_at,
            ultima_gestion_tipo = NEW.tipo_gestion,
            updated_at = timezone('utc'::text, now())
        WHERE id = NEW.cliente_id;

        IF NEW.asignacion_id IS NOT NULL THEN
            UPDATE public.asignaciones_cartera
            SET estado = 'Resuelto'
            WHERE id = NEW.asignacion_id;
        END IF;
    ELSE
        UPDATE public.clientes
        SET ultima_gestion_fecha = NEW.created_at,
            ultima_gestion_tipo = NEW.tipo_gestion,
            updated_at = timezone('utc'::text, now())
        WHERE id = NEW.cliente_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tras_gestion ON public.bitacora_gestiones;
CREATE TRIGGER trg_tras_gestion
AFTER INSERT ON public.bitacora_gestiones
FOR EACH ROW EXECUTE FUNCTION actualizar_estado_tras_gestion();

-- 11. ÍNDICES DE ALTO RENDIMIENTO
CREATE INDEX IF NOT EXISTS idx_clientes_pais ON public.clientes(pais);
CREATE INDEX IF NOT EXISTS idx_clientes_rango_mora ON public.clientes(rango_mora);
CREATE INDEX IF NOT EXISTS idx_clientes_estado_gestion ON public.clientes(estado_gestion);
CREATE INDEX IF NOT EXISTS idx_asignaciones_agente_fecha ON public.asignaciones_cartera(agente_id, fecha_agenda);
CREATE INDEX IF NOT EXISTS idx_bitacora_cliente ON public.bitacora_gestiones(cliente_id);

-- 12. SEGURIDAD Y POLÍTICAS RLS (Row Level Security)
ALTER TABLE public.agentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones_cartera ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora_gestiones ENABLE ROW LEVEL SECURITY;

-- Políticas de lectura básica:
CREATE POLICY "Acceso total agentes autenticados" ON public.agentes
    FOR ALL TO authenticated USING (true);

CREATE POLICY "Acceso clientes por país del agente" ON public.clientes
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.agentes a
            WHERE a.auth_id = auth.uid()
            AND (a.rol = 'admin' OR a.pais = clientes.pais)
        )
    );

CREATE POLICY "Gestiones permitidas por agente asignado" ON public.bitacora_gestiones
    FOR ALL TO authenticated
    USING (
        agente_id IN (SELECT id FROM public.agentes WHERE auth_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.agentes WHERE auth_id = auth.uid() AND rol = 'admin')
    );

-- 13. DATOS SEMILLA (CAMPOS DINÁMICOS POR DEFECTO)
INSERT INTO public.campos_formulario_dinamico (nombre_campo, etiqueta, tipo_campo, opciones, es_obligatorio, orden, activo)
VALUES
    ('tipo_gestion', 'Tipo de Gestión', 'dropdown', ARRAY['Llamada', 'WhatsApp', 'Email', 'Visita'], true, 1, true),
    ('contacto_exitoso', '¿Contacto exitoso?', 'dropdown', ARRAY['Sí', 'No', 'Sin respuesta'], true, 2, true),
    ('tipo_acuerdo', 'Acuerdo', 'dropdown', ARRAY['Promesa de Pago', 'Negociación de Cuotas', 'Sin Acuerdo', 'Disputa de Factura'], true, 3, true),
    ('fecha_limite', 'Fecha límite', 'datepicker', NULL, true, 4, true),
    ('monto_comprometido', 'Monto comprometido', 'text', NULL, true, 5, true),
    ('opciones_pago', 'Opciones de Pago Ofrecidas', 'checkbox', ARRAY['Pago Total Inmediato', '2 Cuotas Quincenales', '3 Cuotas Mensuales', 'Condonación Intereses'], false, 6, true),
    ('observaciones', 'Observaciones libres', 'text', NULL, false, 7, true)
ON CONFLICT DO NOTHING;
