# APROVA — imagem de processo único (backend Express serve o frontend + SQLite).
# Pensada para hosts "always-on" com volume persistente (Railway/Fly/Render).
# Persistência fica no volume montado (ex.: /data): DATABASE_URL=file:/data/aprova.db
# e UPLOAD_DIR=/data/uploads.
FROM node:20-slim

# OpenSSL é exigido pelo engine do Prisma em imagens slim.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests primeiro (cache de dependências). Workspaces: backend + frontend.
COPY package*.json ./
COPY backend/package*.json backend/
COPY frontend/package*.json frontend/
RUN npm ci

# Código-fonte
COPY . .

# Prisma Client + builds (frontend/dist e backend/dist).
RUN npm run db:generate -w backend \
 && npm run build -w frontend \
 && npm run build -w backend

# O backend serve o frontend na mesma origem. PORT é injetado pelo host (Railway).
ENV SERVE_FRONTEND=true
EXPOSE 3001

RUN chmod +x /app/railway-entrypoint.sh
CMD ["/app/railway-entrypoint.sh"]
