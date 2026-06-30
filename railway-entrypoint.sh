#!/bin/sh
# Entrypoint do APROVA em host com volume persistente (Railway/Fly/Render).
# 1) aplica migrations no SQLite do volume; 2) na PRIMEIRA subida (banco vazio)
# semeia dados de DEMONSTRAÇÃO; 3) sobe o servidor (processo único).
set -e

cd /app/backend

# Garante que os diretórios do volume existam (banco + anexos) antes do migrate.
DB_PATH="${DATABASE_URL#file:}"
mkdir -p "$(dirname "$DB_PATH")" "${UPLOAD_DIR:-/data/uploads}" 2>/dev/null || true

echo "[aprova] Banco: ${DATABASE_URL}  | Uploads: ${UPLOAD_DIR:-/data/uploads}"
echo "[aprova] Aplicando migrations (prisma migrate deploy)..."
npx prisma migrate deploy

# Semeia só quando o banco está vazio (evita duplicar em reinícios).
USERS=$(node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.count().then(c=>{process.stdout.write(String(c));return p.\$disconnect();}).catch(()=>{process.stdout.write('0');});" 2>/dev/null || echo 0)

if [ "$USERS" = "0" ]; then
  echo "[aprova] Banco vazio — semeando dados de DEMONSTRAÇÃO (ambiente de teste)."
  echo "[aprova] Usuários demo: admin/rh/financeiro/gestor/joao @aprova.com — senha: senha123"
  npm run db:seed
else
  echo "[aprova] Banco já populado ($USERS usuários) — pulando seed."
fi

cd /app
echo "[aprova] Iniciando servidor..."
exec node backend/dist/index.js
