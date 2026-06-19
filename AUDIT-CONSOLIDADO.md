# 🔍 Auditoria Consolidada — Aplicação FLOW / APROVA

**Data:** 2026-06-19
**Escopo solicitado:** revisar e auditar a aplicação e o banco de dados; informar se está apta para uso ou se ainda precisa de desenvolvimento.
**Fluxos-alvo:** pagamento, compra, onboarding, offboarding (+ módulo de inventário).

---

## ⚠️ Achado estrutural nº 1 — a aplicação está fragmentada em branches paralelas, nenhuma integrada ao `main`

Três agentes desenvolveram **em paralelo, partindo todos do commit inicial `a6d7ac3`**, sem merge entre si. O `main` continua só com o esqueleto. Hoje existem **duas implementações completas e concorrentes** do mesmo sistema de fluxos, mais um módulo de inventário construído sobre o esqueleto antigo:

| Branch | Foco | Commits | Veredito | Completude |
|--------|------|---------|----------|-----------|
| `aprova-onboarding-offboarding-bt2nj5` | Fluxos (segura) | 7 | 🟢 **Apta com ressalvas** | ~85% |
| `onboarding-offboarding-payment-flow-mqw4sq` | Fluxos (UI rica) | 7 | 🔴 **Não apta** | ~70% |
| `aprova-inventory-db-d2v3cr` | Inventário/ativos | 4 | 🟡 **Apto com ressalvas** | ~80% |

**Nenhuma pode ir para produção como está, e elas não se combinam automaticamente** (arquiteturas de rotas divergentes). É preciso uma decisão de integração.

---

## 🎯 Veredito e recomendação

**A aplicação NÃO está apta para uso em produção hoje.** Ainda é necessário desenvolvimento e, antes disso, uma **consolidação**: escolher uma base, descartar/portar a outra e integrar o inventário.

**Recomendação: adotar `bt2nj5` como base oficial.** É a única que corrigiu as falhas críticas de segurança (segregação de funções, escalonamento de privilégio, JWT, aprovação dupla), usa dinheiro em centavos (`Int`), aplica transações e validação (Zod), e compila com `strict: true`. A `mqw4sq` tem frontend mais bonito, mas repete **todos os bloqueadores críticos** do relatório inicial — o que a torna inadequada como base.

Caminho sugerido:
1. Eleger `bt2nj5` como base.
2. Fechar as ressalvas de `bt2nj5` (abaixo) — esforço pequeno/médio.
3. Portar para ela as features boas da `mqw4sq` que faltam (editor visual de fluxo, branching condicional, setores) — esforço médio.
4. Integrar o módulo de inventário (`d2v3cr`) sobre essa base, cabeando de fato a automação onboarding/offboarding ↔ ativos.

---

## 🟢 Branch `bt2nj5` — base recomendada (Apta com ressalvas, ~85%)

**Executabilidade:** ✅ `tsc --noEmit` 0 erros (back e front), migrations aplicam, seed roda. 11 rotas registradas.

**Correções da auditoria inicial já aplicadas (excelente):**
- JWT centralizado em `config.ts`; falha ao subir sem `JWT_SECRET` em produção.
- `register` ignora `role` do body (sem escalonamento).
- Self-approval bloqueado: initiator excluído da atribuição + guarda explícita (`approvals.ts:39`).
- Aprovação dupla impedida: `@@unique([requestId, approverId, stepOrder])` + tratamento P2002.
- Dinheiro em centavos (`Int`), não `Float`.
- Alçada por valor de fato aplicada; conclusão "N de M".
- Atomicidade via `$transaction` em criação/decisão/avanço/cancelamento.
- Upload com whitelist MIME+extensão, bloqueio SVG/HTML, download força `octet-stream` + anti path-traversal.
- helmet, CORS por allowlist, rate-limit em `/api/auth`, validação Zod.

**Ressalvas a fechar:**

| Sev | Item | Local |
|-----|------|-------|
| 🟠 | **Fluxo de COMPRA ausente no seed** (só há ONBOARDING/OFFBOARDING/PAYMENT) — falha o requisito de 4 fluxos | `backend/prisma/seed.ts` |
| 🟠 | **`requiresAttachment` nunca é exigido** na conclusão da etapa | `approvals.ts`, `workflow.ts` |
| 🟠 | **UI não captura campos de onboarding/offboarding** (`targetEmployeeId`, `targetDepartmentId`, `startDate`) | `frontend/src/pages/NewRequest.tsx` |
| 🟡 | Resolução de alçada depende da ordem de inserção; fallback silencioso ao "último nível" | `workflow.ts:24-30` |
| 🟡 | `amountCents` opcional mesmo em fluxos com alçada → pagamento de alto valor pode rotear como R$0 | `requests.ts:16` |
| 🟡 | Onboarding "Execução RH" usa `requiredRole: 'USER'` (qualquer um) — falta papel/filtro de RH | `seed.ts:52` |
| 🟡 | `PUT /flow-templates/:id` não edita etapas/alçadas; sem exclusão de template | `flow-templates.ts:110` |
| 🟡 | `Attachment.uploadedBy` é String solta (não FK para User) | `schema.prisma:158` |
| 🟡 | Login navega durante render (anti-pattern React) | `frontend/.../Login.tsx:13` |
| 🟡 | **Sem testes** | repo inteiro |

---

## 🔴 Branch `mqw4sq` — não usar como base (Não apta, ~70%)

**Executabilidade:** ✅ compila, sobe, 5 migrations, seed completo, **os 4 fluxos no seed** e frontend rico (FlowEditor, ResourceManagement, Setores, branching, SLA, aprovação em lote).

**Mas repete os bloqueadores críticos da auditoria original** — é um sistema de aprovação sem controle de aprovação:

| Sev | Item | Local |
|-----|------|-------|
| 🔴 | **`/requests/:id/approve` sem controle de acesso algum** — qualquer autenticado aprova qualquer solicitação; **self-approval livre** (botão só escondido no front) | `requests.ts:171-203` |
| 🔴 | **Aprovação dupla possível** — sem unique; `isStepComplete` conta todas as approvals, não aprovadores distintos por etapa | `requests.ts:177`, `workflow.ts:247` |
| 🔴 | **Tarefas sem checagem de propriedade** — qualquer um conclui/rejeita tarefa alheia e move o fluxo de outro | `tasks.ts:100-161` |
| 🔴 | **`register` público aceita `role` do body** → auto-registro como `ADMIN` | `auth.ts:38-67` |
| 🟠 | JWT com fallback hardcoded; sem helmet/rate-limit; CORS fixo em localhost; upload sem whitelist (servido em `/uploads` → XSS); `Float` para dinheiro; listagem de usuários e leitura de requests sem restrição | vários |

O esforço para endurecer a `mqw4sq` é essencialmente reimplementar o que a `bt2nj5` já fez — daí a recomendação. As **boas ideias de UX/feature dela** (editor de fluxo, setores, branching) valem ser portadas para a base segura.

---

## 🟡 Branch `d2v3cr` — módulo de inventário (Apto com ressalvas, ~80%)

**Executabilidade:** ✅ `tsc --noEmit` 0 erros, migração aplica, seed idempotente. Modelagem sólida: `InventoryItem` (catálogo) → `Asset` (unidade) → `AssetMovement` (log imutável), FKs reais, `onDelete` coerente, movimentações atômicas em `$transaction`, uniques adequadas.

**Ressalvas:**

| Sev | Item | Local |
|-----|------|-------|
| 🟠 | **Integração com onboarding/offboarding é só um campo solto** — `services/workflow.ts` está **órfão** (não há rotas de flows/requests registradas nesta branch); não há automação de alocar/recolher equipamento ao admitir/desligar | `index.ts`, `assets.ts:252` |
| 🟠 | **Qualquer `USER` pode movimentar/baixar/transferir ativos** (inclusive `DESCARTE` patrimonial) — falta `requireRole` | `assets.ts:173` |
| 🟠 | Movimentação não valida existência de `toUserId`/`toDepartmentId`/`warehouseId`/`requestId` (risco de relação órfã / 500) | `assets.ts:214-252` |
| 🟡 | Sem máquina de estados de `Asset` (ex.: `ALOCACAO` sobre ativo `DESCARTADO`); enums `status`/`condition` não validados; `invoiceValue` em `Float`; faltam `@@index`; `start/complete/cancel` de contagem ignoram regra de não-retrocesso; `strict: false`; sem testes | vários |

Este módulo precisa ser **assentado sobre a base de fluxos escolhida** para a integração patrimonial fazer sentido.

---

## 📌 Resposta direta à pergunta

> *A aplicação está apta para ser utilizada ou ainda precisa de desenvolvimento/alteração?*

**Ainda precisa de desenvolvimento e de uma consolidação.** Nenhuma branch está pronta para produção isoladamente. A `bt2nj5` é a mais próxima (apta com ressalvas) e deve ser a base. Estimo que, escolhida a base, faltam:
- **Curto prazo (tornar utilizável internamente):** adicionar fluxo de Compra ao seed, exigir anexos obrigatórios, capturar campos de onboarding/offboarding na UI, endurecer resolução de alçada. *(itens 🟠 da `bt2nj5`)*
- **Médio prazo (produção):** testes automatizados do motor de workflow/alçadas, papel de RH, edição de templates, e a integração do inventário com automação onboarding/offboarding.
- **Decisão de gestão:** definir a base oficial e descartar/portar as branches concorrentes para evitar mais divergência.

---

*Auditoria read-only. As três implementações foram analisadas em worktrees isoladas; nenhum código de produção foi alterado.*
