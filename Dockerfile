# ==============================================================================
# Dockerfile - Sistema de Cobranza RED (Full-stack Node.js + React + Vite)
# ==============================================================================

# --- ETAPA 1: Construcción (Build Stage) ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar manifiestos de dependencias
COPY package*.json ./

# Instalar todas las dependencias para compilar frontend y backend
RUN npm ci || npm install

# Copiar el código fuente completo del proyecto
COPY . .

# Compilar frontend estático (HTML, CSS Tailwind v4, JS/TS Vite) hacia /dist
RUN npm run build

# --- ETAPA 2: Runtime de Producción (Production Runner) ---
FROM node:20-alpine AS runner

WORKDIR /app

# Variables de entorno por defecto
ENV NODE_ENV=production \
    PORT=3000

# Copiar manifiestos
COPY package*.json ./

# Instalar dependencias requeridas para producción (incluyendo tsx para server.ts)
RUN npm install --omit=dev

# Copiar artefactos compilados del frontend y archivos de servidor
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src/data ./src/data
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/tsconfig*.json ./

# Crear usuario sin privilegios para mayor seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeapp -u 1001 && \
    chown -R nodeapp:nodejs /app

USER nodeapp

# Puerto de escucha del servidor Express (3000)
EXPOSE 3000

# Verificación de salud del contenedor
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Comando de inicio del servidor en producción
CMD ["npx", "tsx", "server.ts"]
