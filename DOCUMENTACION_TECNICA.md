# Documentación Técnica y Funcional: Sistema de Cobranza RED
**Plataforma Integral de Gestión de Cartera, Mora Temprana y Auditoría de Cobranza**

---

## 1. Resumen Ejecutivo y Propósito del Sistema

El **Sistema de Cobranza RED** es una plataforma web integral diseñada para optimizar, estandarizar y auditar el ciclo de cobro de cartera y mora temprana en empresas de telecomunicaciones y servicios corporativos, con cobertura simultánea para **El Salvador (SV)** y **Guatemala (GT)**.

### Propósito Principal:
1. **Reducción de Días de Mora (DSO):** Acelerar el cobro de facturas y documentos tributarios electrónicos (DTE) de 0 a más de 120 días.
2. **Equidad y Productividad Operativa:** Distribuir automáticamente la cartera asignada entre gestores de cobro bajo reglas de negocio estrictas durante la ventana activa del mes (**días 1 al 22**), garantizando un volumen diario manejable (por defecto **40 clientes diarios por gestor**, configurable desde administración).
3. **Estandarización de la Comunicación:** Proveer a los gestores una consola con telefonía PBX directa y una biblioteca interactiva de scripts de cobro con inyección en tiempo real de datos del cliente (nombre, saldo vencido, días mora, fecha compromiso, etc.) para WhatsApp o llamada.
4. **Calidad y Coherencia en la Gestión:** Evaluar cada registro de gestión mediante un **Agente Auditor de IA** que valida la coherencia entre el contacto, el acuerdo, las fechas límites de pago, el monto y las observaciones ingresadas en la bitácora.
5. **Visibilidad en Tiempo Real:** Ofrecer a supervisores y directores métricas consolidadas de recuperación, tasa de contacto, acuerdos de pago y clientes críticos escalados.

---

## 2. Alcance Funcional: ¿Qué hace el sistema actualmente?

El sistema cuenta con dos perfiles de usuario completamente funcionales: **Administrador / Supervisor de Cobros** y **Agente Gestor de Cobro**.

### 2.1. Gestión Multi-País y Multi-Moneda
- **El Salvador (SV):** Moneda en Dólares Estadounidenses (`$ USD`). Integración con cartera de clientes corporativos y personas jurídicas de SV.
- **Guatemala (GT):** Moneda en Quetzales (`Q GTQ`). Cartera diferenciada con ejecutivos de cuenta y ejecutivos comerciales locales (ej. Jonathan Jiménez).
- Cambio de país instantáneo con persistencia de estado y filtros de cartera dedicados.

### 2.2. Ingesta, Asignación Manual y Procesamiento de Cartera SAP ERP
- **Sincronización Automática vía API:** Consume el endpoint de SAP `sapapi.red.com.sv/api/Cliente/clienteasignado` con enriquecimiento de datos cada 3 minutos.
- **Filtro Estricto de Clientes Activos (`estatus`):** El sistema excluye automáticamente cualquier cliente con estatus inactivo (`INACTIVO`, `BAJA`, `CANCELADO`, `SUSPENDIDO`). Únicamente los clientes activos forman parte de la cartera gestionable.
- **Carga Manual de Cartera Individual por Agente (Excel / PDF):** Los administradores pueden ingresar a cualquier agente y subirle su cartera específica en archivos `.xlsx`, `.xls`, `.csv` o `.pdf`.
  - El motor inteligente reconoce automáticamente las columnas esenciales: **Código de Cliente** (ej. `CL000519`, `cod de cliente`, `cardcode`) y **Nombre de Cliente** (`nombre`, `cliente`, `razon social`).
  - Identifica y excluye filas con estatus inactivo en el documento.
  - Cruza y enriquece cada cliente con los datos vivos de SAP ERP (saldos, DTEs, días mora, contactos y facturas).
  - Permite modo reemplazo o adición a la cartera del agente, reflejándose inmediatamente en su agenda y llamadas del 1 al 22.
- **Cruce con Facturas Reales (DTE / SAN 360):** Asocia saldos reales y números de documento tributario electrónico a cada cliente.

### 2.3. Motor de Clasificación de Mora y Priorización
Los clientes se clasifican automáticamente en bandas de mora según sus días de atraso:
* **Al Día / Preventivo (0 días):** Gestión preventiva antes del vencimiento.
* **Mora 1 a 30 días:** Prioridad Normal.
* **Mora 31 a 60 días:** Prioridad Media.
* **Mora 61 a 90 días:** Prioridad Alta.
* **Mora 91 a 120 días:** Prioridad Alta / Crítico.
* **Mora > 120 días:** Cartera jurídica / Pre-jurídica.

### 2.4. Motor de Distribución y Planificación (Días 1 al 22)
- **Ventana Operativa Estricta (1 al 22 del mes):** El sistema programa las gestiones activas únicamente dentro de los primeros 22 días hábiles del mes.
- **Capacidad Diaria Configurable:** El Administrador puede ajustar la cuota diaria de clientes por gestor (valor predeterminado: **40 clientes/día**).
- **Recálculo Inteligente de Agenda:** Al cambiar la capacidad o cargar una nueva cartera, el algoritmo redistribuye las cuentas equilibrando el monto total de deuda y el número de clientes entre los agentes activos.
- **Reagendamiento Dinámico con Control de Sobrecupo (Rollover):** Si un cliente solicita ser contactado en una fecha posterior y ese día ya cuenta con el cupo máximo (ej. 40 clientes), el sistema desplaza automáticamente la gestión con menor prioridad al siguiente día hábil disponible, sin superar el día 22.

### 2.5. Consola de Gestión del Agente (Modal de Cobro 360)
Cuando el gestor hace clic en "Gestionar Cliente", se despliega una consola integral con:
1. **Ficha 360 del Cliente:** Razón social, NIT/DUI, dirección, gestor comercial responsable, saldo total, saldo vencido y desglose de facturas pendientes.
2. **Telefonía PBX Directa:** Marcación rápida a teléfonos principales, secundarios y móviles, con cronómetro de llamada en vivo.
3. **Biblioteca de Scripts de Mensajes:**
   - Selección de plantillas categorizadas (Recordatorio preventivo, mora temprana, compromiso formal, notificación pre-jurídica).
   - **Reemplazo dinámico de variables:** Inserta automáticamente `{cliente}`, `{monto_vencido}`, `{dias_mora}`, `{fecha_promesa}`, `{agente}`.
   - Botón de copia al portapapeles y enlace directo para apertura en WhatsApp Web / Desktop con el mensaje pre-cargado.
4. **Bitácora Dinámica de Gestión:** Formulario de captura configurable desde el panel de administración con campos obligatorios y opcionales (Tipo de gestión, ¿Contacto exitoso?, Acuerdo, Fecha límite de pago, Monto comprometido, Formas de pago ofrecidas y Observaciones).
5. **Escalamiento de Clientes Críticos:** Posibilidad de escalar cuentas con discrepancias graves o disputas de facturas a la bandeja de supervisión.

### 2.6. Agente Auditor de Calidad con IA
- Valida la gestión en el momento en que el agente presiona "Guardar Gestión".
- **Criterios de Auditoría:**
  1. *Coherencia Operativa:* Si se seleccionó "Promesa de Pago", debe existir fecha límite futura y monto mayor a $0.
  2. *Calidad del Detalle:* Revisa que las observaciones expliquen la causa del no pago o los términos acordados.
  3. *Compromiso Real:* Evalúa si se negoció el pago total de la factura del mes.
- **Resultado:** Si es aprobado, celebra con animación de confetti y actualiza el estado a "Resuelto". Si detecta inconsistencias, abre una ventana de retroalimentación con sugerencias para corregir la gestión o reagendar.
- **Resiliencia con Fallback Heurístico:** Si el servicio de IA no responde o no hay conexión a internet, un motor determinista en Node.js evalúa las mismas reglas sin detener la operación del agente.

### 2.7. Panel de Configuración Administrativa
- **Gestión de Agentes:** Alta, baja y activación de gestores del equipo de cobro.
- **Constructor de Bitácora Dinámica:** Permite al administrador crear, reordenar, activar/desactivar y marcar como requeridos nuevos campos para el formulario de gestión sin tocar código.
- **Editor de Biblioteca de Scripts:** Creación y modificación de guiones de cobranza con etiquetas de arrastrar y soltar (drag & drop).

---

## 3. Arquitectura y Stack Tecnológico

El proyecto está construido bajo una arquitectura full-stack moderna y limpia, utilizando estrictamente **HTML5, CSS3 y JavaScript/TypeScript (Node.js)**:

| Capa / Componente | Tecnología | Versión | Función |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | React + TypeScript | 19.0.1 | SPA reactiva con componentes funcionales y hooks. |
| **Empaquetador Frontend** | Vite | 8.3.0 | Compilación ultrarrápida, HMR y generación de estáticos optimizados. |
| **Estilos y Diseño UI** | Tailwind CSS v4 | 4.3.3 | Sistema de diseño utilitario, modo oscuro profesional y responsive. |
| **Iconografía** | Lucide React | 0.546.0 | Conjunto de iconos vectoriales SVG para telefonía, métricas y acciones. |
| **Animaciones & Microinteracciones** | Motion + Canvas Confetti | 12.23.24 | Animaciones fluidas en modales y feedback visual de éxito en cobros. |
| **Lector de Archivos de Cartera** | SheetJS (XLSX) | 0.18.5 | Procesamiento local y seguro de hojas de cálculo de clientes y facturas. |
| **Servidor Backend / API** | Node.js + Express | 4.21.2 | Servidor HTTP, API REST, reverse proxy y servicio de estáticos en prod. |
| **Motor de Ejecución Servidor** | TSX (TypeScript Execute) | 4.21.0 | Ejecución nativa de TypeScript en Node.js sin compilación pesada intermedia. |
| **Inteligencia Artificial** | Google GenAI SDK (@google/genai) | 2.4.0 | Auditoría semántica de llamadas y promesas de pago con Gemini 2.5 Flash. |
| **Persistencia / BackendaaS** | Supabase JS Client | 2.117.2 | Conexión con base de datos remota para sincronización de bitácora y usuarios. |
| **Contenedorización** | Docker + Docker Compose | Alpine 3.20 | Empaquetado portable listo para producción. |

---

## 4. Requerimientos para Despliegue en Subdominio

Para conectar el sistema a un subdominio institucional (por ejemplo: `cobranza.red.com.sv`, `cartera.tuempresa.com` o `gestion.red.com.gt`):

### 4.1. Configuración de DNS
En el panel del proveedor de dominio (Cloudflare, GoDaddy, Route53, etc.), agregar el registro correspondiente:

| Tipo | Host / Nombre | Valor / Destino | TTL |
| :--- | :--- | :--- | :--- |
| **A** | `cobranza` | `<IP_PUBLICA_DEL_SERVIDOR>` | Automático / 300s |
| *o alternativo:* **CNAME** | `cobranza` | `servidor-principal.tuempresa.com` | Automático |

### 4.2. Requerimientos de Red y Puertos
- **Puerto interno de la aplicación:** `3000` (Node.js Express).
- **Puertos externos públicos:**
  - `80` (HTTP - redirige automáticamente a 443).
  - `443` (HTTPS - certificado SSL/TLS con Let's Encrypt o Cloudflare).

### 4.3. Configuración Recomendada de Proxy Inverso (Nginx)

Crea el archivo `/etc/nginx/sites-available/cobranza-red.conf`:

```nginx
server {
    listen 80;
    server_name cobranza.tuempresa.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name cobranza.tuempresa.com;

    # Certificados SSL (ejemplo Certbot / Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/cobranza.tuempresa.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cobranza.tuempresa.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Tamaño máximo de carga para archivos Excel de cartera (50 MB)
    client_max_body_size 50M;

    # Configuración de Proxy hacia el contenedor Docker en puerto 3000
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        
        # Headers para reenviar la IP real del cliente y esquema SSL
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Soporte para WebSockets y conexiones persistentes
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Timeouts para procesamiento de IA y cargas de cartera
        proxy_connect_timeout 60s;
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
    }

    # Endpoint de verificación de salud
    location /api/health {
        proxy_pass http://127.0.0.1:3000/api/health;
        access_log off;
    }
}
```

---

## 5. Guía de Dockerización y Despliegue

El proyecto incluye soporte nativo para **Docker** mediante un `Dockerfile` multi-stage ligero basado en Alpine Linux y un archivo `docker-compose.yml`.

### 5.1. Variables de Entorno (.env)
Crea un archivo `.env` en la raíz del proyecto con los siguientes parámetros:

```env
# Modo de ejecución y puerto
NODE_ENV=production
PORT=3000

# Claves de integración SAP ERP y SAN 360
SAP_API_KEY=fdf0cb340b00402c00a057b0f67c00a3
SAN_API_KEY=BZKM84Q3ZLKZwxajaSSPVzlL37Afz1MOVJhbkesQjLAhh4OkFT2ocs7lbhECxFge

# Credenciales de Supabase
VITE_SUPABASE_URL=https://xgbgyjdojbomkwkuhqpi.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnYmd5amRvamJvbWt3a3VocXBpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MTE0NzUsImV4cCI6MjEwNjE4NzQ3NX0.2xX9d_WgTQaLCNuTI7KA96jN-yBsKQ4e8yHF-Hk8f0w

# Clave de Gemini AI (Opcional, cuenta con fallback local automático)
GEMINI_API_KEY=tu_api_key_aqui
```

### 5.2. Despliegue con Docker Compose (Recomendado)

1. **Construir e iniciar el contenedor en segundo plano:**
   ```bash
   docker compose up -d --build
   ```

2. **Verificar el estado del contenedor y su healthcheck:**
   ```bash
   docker compose ps
   ```

3. **Ver los registros en tiempo real:**
   ```bash
   docker compose logs -f cobranza-red
   ```

4. **Detener el contenedor:**
   ```bash
   docker compose down
   ```

### 5.3. Despliegue Manual con Docker CLI

1. **Construir la imagen:**
   ```bash
   docker build -t cobranza-red:1.0 .
   ```

2. **Ejecutar el contenedor:**
   ```bash
   docker run -d \
     --name cobranza-red-app \
     --restart unless-stopped \
     -p 3000:3000 \
     --env-file .env \
     cobranza-red:1.0
   ```

3. **Probar el endpoint de salud:**
   ```bash
   curl http://localhost:3000/api/health
   ```
   *Respuesta esperada:*
   ```json
   {
     "status": "ok",
     "uptime": 45.2,
     "timestamp": "2026-10-09T04:30:00.000Z",
     "service": "Sistema de Cobranza RED",
     "version": "1.0.0",
     "clientsSV": 100,
     "clientsGT": 100
   }
   ```

---

## 6. Endpoints Principales de la API Backend

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Estado de salud y métricas de uptime del servidor y contenedores. |
| `GET` | `/api/cartera?pais=SV` | Obtiene la cartera enriquecida de El Salvador con saldos de mora. |
| `GET` | `/api/cartera?pais=GT` | Obtiene la cartera enriquecida de Guatemala con saldos en Quetzales. |
| `POST` | `/api/sync` | Dispara la sincronización inmediata con las APIs de SAP ERP. |
| `GET` | `/api/sync/status` | Devuelve el registro cronológico de las sincronizaciones recientes. |
| `GET` | `/api/dynamic-fields` | Lista los campos activos de la bitácora configurables por el Admin. |
| `POST` | `/api/dynamic-fields` | Guarda o actualiza los campos dinámicos de la bitácora. |
| `GET` | `/api/message-scripts` | Obtiene la biblioteca de scripts de cobranza con variables. |
| `POST` | `/api/message-scripts` | Actualiza o agrega plantillas de mensajes personalizadas. |
| `GET` | `/api/workload-config` | Obtiene la configuración de capacidad diaria (días 1 al 22, clientes/día). |
| `POST` | `/api/workload-config` | Actualiza la capacidad diaria de clientes por gestor (default 40). |
| `POST` | `/api/ai-evaluate-gestion` | Agente Auditor que evalúa la coherencia y calidad de la gestión. |
