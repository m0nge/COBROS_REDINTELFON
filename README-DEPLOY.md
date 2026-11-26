# Despliegue con Docker – Sistema de Cobranza RED

Sistema web de cobranza para RED Intelfon (El Salvador y Guatemala). Los agentes gestionan su cartera diaria, registran gestiones, promesas y acuerdos de pago. Los administradores supervisan la operación. El frontend (React) y la API (Node.js/Express) corren en un solo contenedor; los datos viven en Supabase.

## Requisitos

- Docker 24 o superior
- Docker Compose v2 (`docker compose`)
- Salida a internet hacia los servicios listados abajo

## Puerto y acceso

| Puerto interno | Uso |
| --- | --- |
| `3000` | Frontend y API |

- `docker-compose.yml` usa `expose`, no `ports`: el puerto no se publica en el host. Póngalo detrás del proxy inverso (Coolify, Traefik, Nginx) o agregue `ports: ["3000:3000"]` si necesita acceso directo.
- Health check: `GET /api/health` → `{"status":"ok","service":"Sistema de Cobranza RED"}`. La imagen ya trae `HEALTHCHECK` cada 30 s.

## Variables de entorno

Copie `.env.example` a `.env` en la raíz y complete los valores. Nunca suba el `.env` al repositorio.

| Variable | Para qué sirve | Obligatoria |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | URL de Supabase para el navegador. Se incorpora al compilar la imagen | Sí (build) |
| `VITE_SUPABASE_ANON_KEY` | Clave pública anon de Supabase para el navegador. Se incorpora al compilar; nunca use la service-role aquí | Sí (build) |
| `SUPABASE_URL` | URL de Supabase usada por la API | Sí |
| `SUPABASE_SERVICE_ROLE_KEY` | Acceso privilegiado del servidor a Supabase | Sí |
| `SAP_API_KEY` | API de cartera SAP (`sapapi.red.com.sv`) | Sí |
| `SAN_API_KEY` | Visor 360 y conciliación de pagos en SAN (`san.red.com.sv`) | Sí |
| `SAN_TELEGESTION_API_KEY` | Registro de promesas y pagos en la API de telegestión de SAN | Sí |
| `CRON_SECRET` | Token Bearer que protege las rutas de conciliación programada | Sí |
| `CLIENTES_SYNC_TOKEN` | Protege los endpoints de sincronización de clientes y contactos | No |
| `PBX_API_USERNAME` | Usuario de la API PBX (llamadas y audios) | No |
| `PBX_API_PASSWORD` | Contraseña de la API PBX | No |
| `RECLAMOS_API_KEY` | API de reclamos SAC (`sac.red.com.sv`) | No |
| `NODE_ENV` | Fijo en `production` dentro del compose | No |
| `PORT` | Fijo en `3000` dentro del compose | No |

Si cambian `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY`, reconstruya la imagen con `--build`.

## Comandos

```bash
# Levantar (construye la imagen)
docker compose up -d --build

# Estado y health check
docker compose ps

# Logs
docker compose logs -f cobranza-red

# Reiniciar
docker compose restart cobranza-red

# Detener y eliminar el contenedor
docker compose down
```

## Tareas programadas (conciliación de pagos)

Programe dos `GET` diarios al dominio de la app con el encabezado `Authorization: Bearer <CRON_SECRET>`:

| Horario UTC | Ruta |
| --- | --- |
| `0 6 * * *` | `/api/reconciliar-pagos-medianoche` |
| `0 18 * * *` | `/api/reconciliar-pagos-mediodia` |

Sin ellas la app funciona, pero no verifica automáticamente las promesas de pago.

## Servicios externos y accesos de red

El contenedor necesita salida HTTPS (443) hacia:

| Servicio | Host | Uso |
| --- | --- | --- |
| Supabase | `<proyecto>.supabase.co` | Base de datos, autenticación y almacenamiento de comprobantes |
| API SAP | `sapapi.red.com.sv` | Cartera asignada por país |
| SAN 360 | `san.red.com.sv` | Facturas, saldos y conciliación de pagos |
| PBX | `api.red.com.sv` | Listado de llamadas y audios |
| SAC Reclamos | `sac.red.com.sv` | Consulta de reclamos del cliente |

Los navegadores de los usuarios también necesitan acceso a Supabase. El detalle de Coolify está en `COOLIFY.md`.
