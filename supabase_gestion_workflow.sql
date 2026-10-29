-- Ejecutar en Supabase SQL Editor en modo de prueba.
-- Primero se agregan los estados nuevos; después se reemplaza el trigger para
-- que una gestión válida no cierre una cartera como Resuelta.
ALTER TYPE public.estado_gestion_tipo ADD VALUE IF NOT EXISTS 'Contactado';
ALTER TYPE public.estado_gestion_tipo ADD VALUE IF NOT EXISTS 'Reprogramado';

CREATE OR REPLACE FUNCTION public.actualizar_estado_tras_gestion()
RETURNS TRIGGER AS $$
DECLARE
  estado_resultado TEXT;
BEGIN
  estado_resultado := COALESCE(
    NEW.valores_dinamicos->>'estado',
    CASE WHEN NEW.contacto_exitoso = 'Si' THEN 'Contactado' ELSE 'Reprogramado' END
  );

  IF NEW.validacion_exitosa IS TRUE THEN
    UPDATE public.clientes
    SET estado_gestion = estado_resultado::public.estado_gestion_tipo,
        ultima_gestion_fecha = NEW.created_at,
        ultima_gestion_tipo = NEW.tipo_gestion,
        updated_at = timezone('utc'::text, now())
    WHERE id = NEW.cliente_id;

    IF NEW.asignacion_id IS NOT NULL THEN
      UPDATE public.asignaciones_cartera
      SET estado = estado_resultado::public.estado_gestion_tipo
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

-- Nota: la conciliación automática en SAP/SAN solo marca la promesa local como
-- cumplida si la consulta devuelve facturas y todas aparecen saldadas.
