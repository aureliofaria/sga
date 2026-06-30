# Deploy de TESTE no Railway (homologação clicável)

Ambiente de **teste/homologação** do APROVA no Railway, rodando o app **como em
produção** (processo único: backend Express serve o frontend + SQLite), porém com
**dados de demonstração** já semeados para clicar e validar os fluxos.

> ⚠️ Isto é um ambiente de TESTE: usa usuários demo (senha `senha123`). Para o
> go-live REAL, use o servidor interno seguindo `DEPLOY.md` (com
> `NODE_ENV=production`, `ADMIN_EMAIL`/`ADMIN_PASSWORD` e **sem** dados demo).

## Como funciona
- `Dockerfile` constrói tudo (frontend + backend + Prisma) e `railway-entrypoint.sh`
  aplica as migrations e, **na primeira subida (banco vazio)**, semeia os dados de
  demonstração. Em reinícios, não re-semeia.
- **Persistência** fica num **Volume** montado em `/data`: o SQLite e os anexos
  vivem lá (`DATABASE_URL=file:/data/aprova.db`, `UPLOAD_DIR=/data/uploads`), então
  os dados sobrevivem a reinícios/redeploys.

## Passo a passo (~10 min)

1. **railway.app → New Project → Deploy from GitHub repo** → selecione
   `aureliofaria/APROVA`, branch **`main`**. O Railway detecta o `Dockerfile`.

2. **Adicione um Volume** ao serviço (aba *Volumes* / *Data*): mount path **`/data`**.
   > O `Dockerfile` já usa `/data` por padrão (`DATABASE_URL=file:/data/aprova.db`,
   > `UPLOAD_DIR=/data/uploads`) — então **basta montar o volume em `/data`**.

3. **Variáveis** (aba *Variables*) — só uma é obrigatória:
   ```
   JWT_SECRET = <gere: openssl rand -hex 32>
   ```
   > Opcionais (já têm default `/data` na imagem): `DATABASE_URL`, `UPLOAD_DIR`.
   > **Não** defina `NODE_ENV=production` neste ambiente de teste — é o que permite
   > o seed de demonstração. **Não** defina `PORT`: o Railway injeta a porta.

   **Notificações por e-mail (opcional — canal Outlook/Office 365):**
   ```
   NOTIFICATIONS_EXTERNAL_ENABLED = true
   SMTP_HOST = smtp.office365.com
   SMTP_PORT = 587
   SMTP_SECURE = false
   SMTP_USER = <conta corporativa, ex.: aprova@golplus.com.br>
   SMTP_PASS = <senha de app da conta>
   SMTP_FROM = APROVA <aprova@golplus.com.br>
   APP_URL = https://<seu-domínio-railway>   # usado nos links dos e-mails
   ```
   > Com isso, os responsáveis recebem e-mail ao ganhar tarefa/aprovação pendente,
   > correção solicitada, etc. Sem essas variáveis, vale só o aviso in-app.
   > **Teams (opcional):** `TEAMS_WEBHOOK_URL = <Incoming Webhook do canal>`.

   **Alternativa recomendada para Microsoft 365 — Graph (não exige SMTP AUTH):**
   crie um *App Registration* no Entra/Azure com permissão de **aplicação**
   `Mail.Send` (com **consent de admin**) e configure:
   ```
   NOTIFICATIONS_EXTERNAL_ENABLED = true
   GRAPH_TENANT_ID     = <Directory (tenant) ID>
   GRAPH_CLIENT_ID     = <Application (client) ID>
   GRAPH_CLIENT_SECRET = <client secret gerado no App Registration>
   GRAPH_SENDER        = <caixa remetente, ex.: naoresponda@golplus.com.br>
   APP_URL             = https://<seu-domínio-railway>
   ```
   > Quando o Graph está configurado, ele é usado no lugar do SMTP. Não precisa
   > das variáveis `SMTP_*` neste caso.

4. **Deploy**. Acompanhe os logs: devem mostrar "Aplicando migrations", "semeando
   dados de DEMONSTRAÇÃO" e "Iniciando servidor".

5. **Gere o domínio público**: *Settings → Networking → Generate Domain*.

6. Acesse a URL e entre com **`admin@aprova.com` / `senha123`** (ou rh/financeiro/
   gestor/joao @aprova.com). A trilha de onboarding, pagamentos e o roteamento já
   estão prontos para teste; o setor Financeiro tem Líder I (Carlos) para receber
   pagamentos.

## Limitações deste ambiente de teste
- É monoinstância (1 réplica) — adequado para homologação, não para carga.
- Os agendadores (escalonamento/recorrências) rodam no processo; para forçar a
  geração de recorrências use o botão **"Gerar vencidas agora"**.
- Notificações: só **in-app** (Teams/Outlook desligado).
