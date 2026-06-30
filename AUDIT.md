# 🔍 Auditoria — Aplicação FLOW

**Sistema:** Fluxos de pagamento, compra, onboarding e offboarding (codinome interno "APROVA"/"SGA")
**Data:** 2026-06-17
**Branch auditada:** `claude/flow-app-audit-2g02g7`
**Commit base:** `a6d7ac3` — *feat: inicializa estrutura do backend APROVA*
**Escopo:** Backend (Express + Prisma + SQLite). Frontend ainda inexistente.

---

## Resumo executivo

A base contém **fundações razoáveis** (schema Prisma bem modelado, middleware de auth/upload, rotas de usuários/departamentos), mas **a aplicação não roda e o núcleo de workflow está inacessível**. Foram encontrados **1 bug que quebra toda a autenticação**, **2 brechas de segurança críticas** e várias falhas de lógica nos fluxos de aprovação que comprometem o propósito do sistema (segregação de alçadas).

**Veredito: não está executável e não está pronto para uso. Estimativa de ~40% do backend implementado.**

| Severidade | Quantidade |
|-----------|-----------|
| 🔴 Bloqueadores (não executa) | 5 |
| 🔴 Críticos (segurança / quebra funcional) | 4 |
| 🟠 Altos (lógica de workflow) | 4 |
| 🟡 Médios (segurança secundária / modelagem) | 7 |

---

## 🔴 BLOQUEADORES — a aplicação não executa

| # | Problema | Impacto |
|---|----------|---------|
| B1 | **Falta `backend/src/index.ts`** (entry point referenciado por `dev`/`build`/`start` no `package.json`) | `npm run dev:backend` falha de imediato. Nenhum servidor sobe. |
| B2 | **Faltam as rotas do núcleo**: `requests`, `tasks`, `approvals`, `flow-templates`, `attachments`, `audit-logs` | Toda a lógica de fluxo (criar solicitação, aprovar, avançar etapa, anexar) está **inacessível por HTTP**. O `workflow.ts` é código morto no estado atual. |
| B3 | **Falta `prisma/seed.ts`** (referenciado por `db:seed` e por `npm run setup`) | `npm run setup` quebra. |
| B4 | **Workspace `frontend` declarado mas inexistente** (`package.json` raiz) | `npm install` / `npm run setup` falham no workspace ausente. |
| B5 | **Sem `.env`/`.env.example` e sem pasta de migrations** (`backend/prisma/migrations`) | `JWT_SECRET` e `DATABASE_URL` não documentados; primeira migration precisa ser criada. |

---

## 🔴 CRÍTICOS — segurança e quebra funcional

### C1 — Segredos JWT divergentes → autenticação 100% quebrada (sem env)
- `backend/src/routes/auth.ts:8` assina o token com fallback `'sga-secret-2024'`
- `backend/src/middleware/auth.ts:5` verifica com fallback `'aprova-secret-2024'`

Se `JWT_SECRET` não estiver no ambiente (caso de dev, e **não há `.env`**), **todo token gerado no login falha na verificação**. Nenhum usuário consegue acessar rota autenticada. Além disso, segredo hardcoded versionado é vazamento.

**Correção:** centralizar o segredo em um único módulo de config e exigir `JWT_SECRET` em produção (falhar no boot se ausente).

### C2 — Escalonamento de privilégio no `/register` público
`backend/src/routes/auth.ts:38-57`
```ts
role: count === 0 ? 'ADMIN' : (role || 'USER')
```
O endpoint é **público** e o `role` vem do corpo da requisição. Qualquer pessoa pode se registrar escolhendo o próprio papel (`'CFO'`, `'DIRETOR'`, `'MANAGER'`…) e cair diretamente numa alçada de aprovação. Em um sistema de aprovação de **pagamentos/compras**, é grave.

**Correção:** remover `role` do corpo no registro público (sempre `USER`), ou restringir criação de usuários ao `ADMIN` (já existe `POST /users` protegido).

### C3 — Sem segregação de funções (self-approval)
`backend/src/services/workflow.ts:26-29` — quando uma etapa não tem aprovadores por papel, o fallback atribui a tarefa **ao próprio iniciador**. Nada impede que o solicitante aprove a própria solicitação de pagamento. Viola o princípio de quatro-olhos exigido em qualquer fluxo financeiro.

**Correção:** excluir o iniciador da lista de possíveis aprovadores; bloquear aprovação onde `approverId === initiatorId`.

### C4 — Aprovação múltipla pelo mesmo aprovador burla `requiredApprovers`
O modelo `Approval` não possui restrição `@@unique([requestId, approverId, stepOrder])`. Em `workflow.ts:157` a contagem é `approvals.filter(APPROVED).length`. Um único aprovador pode registrar N aprovações e **sozinho satisfazer uma alçada que exige 2+ aprovadores**.

**Correção:** adicionar unique composto e validar no endpoint de aprovação que o aprovador ainda não votou naquela etapa.

---

## 🟠 ALTOS — lógica de workflow inconsistente

### A1 — Alçada (`AuthorizationLevel`) calculada mas nunca aplicada
`checkAuthorizationLevel()` resolve o nível por valor e expõe `approverRole`, mas `createRequestTasks` só usa `step.requiredRole` — **o `approverRole` da alçada é ignorado** ao criar as tarefas. A faixa de valor não direciona para o aprovador correto. A funcionalidade central de "alçadas por valor" está desconectada da atribuição de tarefas.

### A2 — Etapa por papel exige que TODOS daquele papel completem
`workflow.ts:18-23` cria tarefa para **todos** os usuários com o papel (`findMany`), e `isStepComplete` (`workflow.ts:142`) exige `every(COMPLETED)`. Se há 5 gerentes, os 5 precisam agir. O comportamento esperado é provavelmente "qualquer 1" (ou `requiredApprovers`). Conflita com a lógica de alçadas.

### A3 — Operações não transacionais
`advanceRequest` faz `update` + `createRequestTasks` (vários inserts) sem `prisma.$transaction`. Falha no meio deixa a solicitação inconsistente. Há também risco de corrida (dois aprovadores simultâneos → etapa avança duas vezes / tarefas duplicadas).

### A4 — Disparo da etapa inicial ausente
Não há gancho que chame `createRequestTasks(..., 0)` na criação da solicitação (nem rota que o faça). O fluxo nunca arranca no estado atual.

---

## 🟡 MÉDIOS — segurança secundária e modelagem

| # | Item | Local |
|---|------|-------|
| M1 | **Upload sem validação de tipo** — aceita qualquer MIME/extensão. Risco de `.html`/`.svg` (XSS se servido) ou executáveis. Limite de 10 MB é a única barreira. Falta whitelist de `mimetype`. | `middleware/upload.ts` |
| M2 | **Sem `helmet`, sem rate-limit no `/login`** (brute force), sem validação de entrada (ex.: `zod`). `cors` está nas deps mas a config vive no `index.ts` inexistente. | global |
| M3 | **Dinheiro como `Float`** (`Request.amount`) — ponto flutuante gera erro de arredondamento em comparações de alçada (`amount >= min`). Usar inteiro em centavos ou `Decimal`. | `schema.prisma:86` |
| M4 | **`targetEmployee`/`targetDepartment` como String solta** — para onboarding/offboarding deveriam referenciar `User`/`Department`. Perde integridade referencial. | `schema.prisma:83-84` |
| M5 | **Tipagem de datas inconsistente** — `Request.startDate` é `String?`, enquanto `dueDate`/`completedAt` são `DateTime`. | `schema.prisma:85` |
| M6 | **Cascades mistos / sem índices** — `Request → FlowTemplate` sem `onDelete`; deletar template com solicitações falha. Sem índices em `status`, `assigneeId`, `currentStep`. | `schema.prisma` |
| M7 | **`PUT /users/:id`** troca e-mail sem checagem de unicidade (cai em 500 silencioso). `strict: false` no `tsconfig` desliga checagens importantes do TS. | `routes/users.ts:55`, `tsconfig.json:8` |

---

## ✅ Pontos positivos

- Schema Prisma cobre bem o domínio (templates, etapas, alçadas, tarefas, aprovações, anexos, **audit log**).
- Senhas com `bcrypt`; `passwordHash` removido de todas as respostas.
- `DELETE` de usuário é soft-delete (`isActive`).
- Trilha de auditoria (`AuditLog`) modelada desde o início — bom para compliance financeiro.
- Controle de acesso por papel (`requireRole`) já presente em rotas administrativas.

---

## Recomendação de prioridade

1. **Corrigir C1** (unificar `JWT_SECRET`) e **C2** (remover `role` do `/register` público).
2. **Implementar B1/B2** (`index.ts` + rotas de `requests`/`approvals`/`tasks`) para o fluxo existir.
3. **C3/C4 + A1/A2** — redesenhar a relação tarefa ↔ aprovação ↔ alçada com segregação de funções.
4. Demais itens (B3–B5, médios).

---

## Apêndice — Inventário de arquivos auditados

```
backend/package.json
backend/tsconfig.json
backend/prisma/schema.prisma
backend/src/lib/prisma.ts
backend/src/middleware/auth.ts
backend/src/middleware/upload.ts
backend/src/routes/auth.ts
backend/src/routes/departments.ts
backend/src/routes/users.ts
backend/src/services/workflow.ts
package.json (raiz)
.gitignore
```

**Ausentes (esperados):** `backend/src/index.ts`, `backend/prisma/seed.ts`, rotas de `requests`/`tasks`/`approvals`/`flow-templates`/`attachments`, `backend/prisma/migrations/`, `backend/.env(.example)`, workspace `frontend/`.
