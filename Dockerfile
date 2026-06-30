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

# Defaults de runtime — apontam o SQLite e os anexos para o VOLUME persistente
# (monte um volume em /data no host). O DATABASE_URL é ABSOLUTO de propósito: o
# Prisma o usa tanto no migrate/seed quanto no client em runtime, evitando o bug
# de caminho relativo resolvido de formas diferentes conforme o cwd. As variáveis
# do serviço no Railway podem sobrepor estes valores.
ENV DATABASE_URL=file:/data/aprova.db
ENV UPLOAD_DIR=/data/uploads
ENV SERVE_FRONTEND=true

# Prisma Client + builds (frontend/dist e backend/dist).
RUN npm run db:generate -w backend \
 && npm run build -w frontend \
 && npm run build -w backend

# PORT é injetado pelo host (Railway).
EXPOSE 3001

RUN chmod +x /app/railway-entrypoint.sh
CMD ["/app/railway-entrypoint.sh"]
