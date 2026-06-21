# Deploy do APROVA — Servidor local / Rede interna (V1)

Guia para colocar o APROVA no ar em **um servidor da rede interna**, com os
usuários acessando pelo **navegador via IP** (`http://<ip-do-servidor>:<porta>`).

A V1 usa **deploy de processo único**: o próprio backend (Node) serve o frontend
já compilado, deixando tudo na **mesma origem** — sem necessidade de nginx e sem
CORS. Banco em **SQLite** (arquivo no disco), suficiente para uso interno.

```
  Navegadores na LAN                      Servidor (uma máquina)
  ┌────────────────┐                      ┌──────────────────────────────┐
  │ http://IP:3001 │ ── HTTP (LAN) ─────▶ │ Node/Express                  │
  │  (Chrome/Edge) │ ◀── HTML/JS/JSON ─── │  • / e assets  → frontend/dist │
  └────────────────┘                      │  • /api/*      → API           │
                                          │  • /uploads/*  → anexos        │
                                          │  • SQLite (dev.db) + uploads/  │
                                          └──────────────────────────────┘
```

## 1. Pré-requisitos do servidor
- **Node.js 20+** e npm.
- Uma máquina Linux/Windows na LAN com **IP fixo** (ou hostname) e a **porta liberada** no firewall.
- ~500 MB livres + espaço para o banco e anexos.

## 2. Obter o código
```bash
git clone <url-do-repo> sga && cd sga
# ou copie a pasta do projeto para o servidor
```

## 3. Configurar o ambiente (backend/.env)
```bash
cp backend/.env.example backend/.env
```
Edite `backend/.env`:
```env
NODE_ENV=production
PORT=3001                      # porta de acesso (ver nota sobre porta 80 abaixo)
JWT_SECRET=<gere com: openssl rand -hex 32>
DATABASE_URL="file:./dev.db"
SERVE_FRONTEND=true            # backend serve o frontend (processo único)
NOTIFICATIONS_EXTERNAL_ENABLED=false
```
> `JWT_SECRET` é **obrigatório** em produção — a aplicação não sobe sem ele.

## 4. Instalar, migrar e compilar
```bash
npm install                                   # instala backend + frontend (workspaces)
npm run db:generate --workspace=backend       # gera o Prisma Client
npm run db:deploy  --workspace=backend         # aplica as migrations (cria o dev.db)

# Seed inicial de PRODUÇÃO: cria os fluxos + catálogo de inventário e UM
# administrador a partir das variáveis de ambiente. NÃO cria usuários nem
# solicitações de demonstração quando NODE_ENV=production.
NODE_ENV=production ADMIN_EMAIL="voce@empresa.com" ADMIN_PASSWORD="<senha forte>" \
  npm run db:seed --workspace=backend

npm run build --workspace=frontend            # gera frontend/dist
npm run build --workspace=backend             # gera backend/dist
```
> Se o script `db:deploy` não existir, use: `npx prisma migrate deploy --schema backend/prisma/schema.prisma`.

> ⚠️ **Rode o seed só na primeira vez.** Em produção (`NODE_ENV=production`) ele
> **exige** `ADMIN_EMAIL` e `ADMIN_PASSWORD` e **não** cria contas de demonstração.
> Sem `NODE_ENV=production`, o seed cria usuários de demonstração com senha
> padrão (`senha123`) — **apenas para testes locais, nunca em produção.**

## 5. Subir a aplicação
```bash
npm start --workspace=backend     # equivale a: node dist/index.js (lê backend/.env)
```
Acesse de qualquer PC da rede: **`http://<ip-do-servidor>:3001`**

### Validação pós-deploy (smoke E2E)
Com o servidor no ar, valide os fluxos críticos de ponta a ponta. **Requer um
banco com dados de demonstração** (rode o seed SEM `NODE_ENV=production` num
ambiente de homologação) — não rode contra o banco de produção:
```bash
BASE=http://<ip>:3001 npm run test:e2e --workspace=backend
```
Esperado: **35 verificações, 0 falhas** (login multi-papel, criação, alçada,
segregação, anexo obrigatório, admissão→alocação de ativo, notificações,
auditoria/Excel, relatórios, RBAC, frontend servido).

### Manter no ar (systemd — Linux)
`/etc/systemd/system/aprova.service`:
```ini
[Unit]
Description=APROVA
After=network.target

[Service]
Type=simple
WorkingDirectory=/caminho/para/sga/backend
ExecStart=/usr/bin/node dist/index.js
EnvironmentFile=/caminho/para/sga/backend/.env
Restart=always
User=aprova
# Para usar a porta 80 sem rodar como root, descomente:
# AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now aprova
sudo systemctl status aprova
```

## 6. Acesso sem a porta na URL (opcional)
Para acessar `http://<ip>` (porta 80) em vez de `:3001`:
- **A)** `PORT=80` no `.env` + `AmbientCapabilities=CAP_NET_BIND_SERVICE` no systemd; ou
- **B)** um proxy reverso (nginx) na porta 80 encaminhando para o Node:
  ```nginx
  server {
    listen 80;
    server_name _;
    client_max_body_size 20m;            # uploads
    location / { proxy_pass http://127.0.0.1:3001; proxy_set_header Host $host; }
  }
  ```
  (com nginx, pode deixar `SERVE_FRONTEND=true` no Node — ele continua servindo o front; o nginx só repassa.)

## 7. HTTPS (recomendado)
Em HTTP puro na LAN funciona, mas o ideal é HTTPS (certificado interno ou
mkcert/Let's Encrypt se houver hostname resolvível). Configure no nginx (opção B).

## 8. Backup
Todo o estado fica em dois lugares dentro de `backend/`:
- **`prisma/dev.db`** (banco)
- **`uploads/`** (anexos)

Backup = copiar esses dois com a aplicação parada (ou usar `sqlite3 .backup`).
```bash
cp backend/prisma/dev.db  /backup/aprova-$(date +%F).db
tar czf /backup/aprova-uploads-$(date +%F).tgz backend/uploads
```

## 9. Atualizar para uma nova versão
```bash
git pull
npm install
npm run db:deploy  --workspace=backend     # aplica migrations novas (preserva dados)
npm run build --workspace=frontend
npm run build --workspace=backend
sudo systemctl restart aprova
```

## 10. Checklist de segurança (antes de liberar para a equipe)
- [ ] `JWT_SECRET` forte e único (`openssl rand -hex 32`).
- [ ] Seed rodado com `NODE_ENV=production` + `ADMIN_EMAIL`/`ADMIN_PASSWORD`
      (sem contas de demonstração no banco de produção).
- [ ] Confirmar que **não** existem usuários `@sga.com` com senha `senha123`
      no banco de produção.
- [ ] Demais usuários reais criados pelo admin na tela de Usuários.
- [ ] Firewall liberando só a porta da aplicação na LAN.
- [ ] Rotina de backup do `dev.db` + `uploads/` agendada.
- [ ] (Recomendado) HTTPS via proxy reverso.

---

### Quando crescer (além da V1)
- Migrar SQLite → **PostgreSQL** (trocar `provider` do Prisma + `DATABASE_URL` e
  regerar as migrations) para concorrência/escala maiores.
- Mover anexos para armazenamento dedicado (object storage).
- Habilitar notificações externas (Teams/Outlook) com conta corporativa M365.
