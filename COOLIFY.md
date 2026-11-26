# Despliegue en Coolify

La aplicación se ejecuta como un servicio Node.js en el puerto `3000`. El frontend y la API quedan en el mismo contenedor; los datos siguen en Supabase y los audios se consultan desde el PBX, así que no se necesita un volumen local para la base de datos.

## Configuración de Coolify

1. Crea un recurso **Docker Compose** desde este repositorio y la rama `main`.
2. Usa la raíz del repositorio como directorio y `docker-compose.yml` como archivo Compose.
3. Configura un dominio HTTPS para el servicio `cobranza-red` en el puerto interno `3000`.
4. Agrega las variables indicadas abajo. Marca las variables sensibles como secretas/encriptadas.
5. Marca `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` como disponibles durante el build: Vite las incorpora al frontend al compilar. Si cambian, vuelve a construir la imagen.
6. Despliega y espera a que el health check de `/api/health` quede en estado saludable.

No publiques el puerto `3000` directamente en el host; Coolify debe enrutar el dominio al puerto interno del contenedor.

## Variables de entorno

| Variable | Requerida | Uso |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Sí, build | URL del proyecto Supabase usado por el navegador |
| `VITE_SUPABASE_ANON_KEY` | Sí, build | Clave pública anon/publishable de Supabase; nunca uses aquí la service-role |
| `SUPABASE_URL` | Sí, runtime | URL del proyecto Supabase usado por la API |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí, runtime | Acceso privilegiado de servidor a Supabase; guárdala como secreto |
| `SAP_API_KEY` | Sí, runtime | Acceso del servidor a la API de cartera SAP |
| `SAN_API_KEY` | Sí, runtime | Acceso del servidor al visor 360 y conciliación SAN |
| `SAN_TELEGESTION_API_KEY` | Sí, runtime | Acceso del servidor para registrar promesas y pagos en SAN |
| `CRON_SECRET` | Sí, runtime | Secreto Bearer para proteger la conciliación programada |
| `CLIENTES_SYNC_TOKEN` | Opcional, runtime | Protege los endpoints de sincronización de clientes y contactos |
| `PBX_API_USERNAME` | Opcional, runtime | Usuario de la API PBX |
| `PBX_API_PASSWORD` | Opcional, runtime | Contraseña de la API PBX; guárdala como secreto |
| `RECLAMOS_API_KEY` | Opcional, runtime | Acceso a la API de reclamos |

`.env.example` enumera los nombres sin valores. No subas un `.env` real al repositorio ni compartas secretos por chat.

## Conciliación automática de pagos

En Vercel estas tareas se ejecutaban con Cron. En Coolify crea dos tareas programadas que hagan un `GET` con el encabezado `Authorization: Bearer $CRON_SECRET` al dominio de la aplicación:

| Horario UTC | Ruta |
| --- | --- |
| `0 6 * * *` | `/api/reconciliar-pagos-medianoche` |
| `0 18 * * *` | `/api/reconciliar-pagos-mediodia` |

Configura `CRON_SECRET` también como variable secreta disponible para esas tareas. Confirma que la zona horaria del programador de Coolify sea UTC; si usa otra, convierte los horarios antes de guardarlos. Sin estas dos tareas, la app seguirá funcionando, pero la conciliación automática que Vercel hacía no correrá.

## Rotación de secretos

Puedes reemplazar `CRON_SECRET` aunque no recuerdes el valor anterior. Configura el mismo secreto nuevo en el servicio y en el encabezado `Authorization: Bearer ...` de las dos tareas programadas; luego vuelve a desplegar o reiniciar el servicio. Las tareas fallarán con `401` si el encabezado y la variable no coinciden.

También puedes reemplazar `CLIENTES_SYNC_TOKEN`. Actualízalo en el servicio y en el encabezado Bearer de cualquier proceso externo que llame a `/api/sync-clientes` o `/api/sync-contactos`; vuelve a desplegar o reiniciar el servicio. Si no usas esos endpoints, puedes dejar esa variable vacía.

Usa valores aleatorios largos, guárdalos como secretos en Coolify y no los incluyas en el ZIP ni en el repositorio. Los horarios cron (`0 6 * * *` y `0 18 * * *`) son independientes de estos tokens; si solo quieres cambiar la hora, conserva las rutas y confirma la zona horaria.

## Ejecución local

1. Copia `.env.example` a `.env` y completa las variables requeridas.
2. Ejecuta `docker compose up --build -d`.
3. Verifica `http://localhost:3000/api/health`.

La clave anon de Supabase es configuración pública del navegador; `SUPABASE_SERVICE_ROLE_KEY`, `SAP_API_KEY`, `SAN_API_KEY`, `SAN_TELEGESTION_API_KEY`, `CRON_SECRET` y la contraseña del PBX son solo para el servidor.
