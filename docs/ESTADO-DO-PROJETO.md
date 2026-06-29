# APROVA — Estado do Projeto (handoff do Maestro)

> Fonte de verdade para retomar o trabalho sem depender da memória da conversa.
> Atualize a cada marco. Acompanha: `SPEC-FASE-0-1.md`, `FASE0-CHECKLIST.md`,
> `PAGAMENTOS.md`, `PAGAMENTOS-SECURITY.md`, `DEPLOY.md`.

## 1. O que é o APROVA
Sistema de gestão de aprovações e fluxos (admissão/onboarding, offboarding, compra, pagamento) para a Gol Plus. Web, servido em processo único (backend Express serve o frontend React; SQLite via Prisma). Nome do produto: **APROVA** — nenhuma alusão a "SGA" (sistema legado abandonado).
**Restrição arquitetural:** construir com contratos de API limpos e baixo acoplamento, deixando costuras prontas para futuro acoplamento com o ERP **Sankhya**.

## 2. Estrutura do time (IA) e governança
- **Maestro** (eu) — Opus 4.8, orquestrador/CTO. Integra (merge), verifica de forma independente, aciona o CEO em decisões estratégicas. Age direto só em integração/hotfix/tarefa crítica acoplada.
- **Bússola** — Sonnet, arquiteto: lógica, modelagem de dados, regras de estado.
- **Motor** — backend/segurança (Opus quando crítico: autorização/alçada/IDOR; Sonnet no rotineiro).
- **Interface** — frontend (React/Tailwind), consome contratos de API do Motor.
- **Lupa** — QA adversarial: **re-executa** testes/sondas, audita segurança/perf/lógica antes do "verde".
- Fluxo por feature: CEO → Maestro → Bússola → (Motor ∥ Interface) → Lupa → Maestro. **Right-sizing**: tarefa pequena usa caminho curto (Motor→Lupa). Executores em **worktree isolado**; Maestro integra + verifica.
- **Calibragem real:** seto o *modelo* por agente; "esforço" é aproximado via rigor de briefing + verificação + tier do modelo. Custo: mais tokens — dimensionar para não desperdiçar.

## 3. Branches, PRs e o que contêm
- **`claude/deploy-v1-2g02g7`** → PR **#8** (base→main). Pacote de deploy (DEPLOY.md, launcher de 1 clique, seed prod seguro), **rebrand APROVA completo**, e a **correção anti-IDOR base** (`21d7579`: guardas + upload 400). HEAD ~`21d7579`.
- **`claude/pagador-fluxo-pagamentos`** → PR **#9**. Fluxo de pagamentos: categorias, recorrência, alçada, **endurecimento de segurança**, frontend de pagamentos, agendador in-process, gancho `FinanceParams`. HEAD `fe27e71`. **79/79 testes, e2e 52/52.**
- **`claude/fase0-organizacao`** → PR **#10** (base→deploy-v1). Fase 0 **COMPLETA (13/13)** + **Fase 1 espinha dorsal** (trilha onboarding 1→11, config-only). **266 testes, smoke e2e 35/35, e2e-onboarding 22/22 (ponta a ponta).**
- Branch de tarefa do designado é mesclada (ff) na branch da fase pelo Maestro após verificação.

## 4. Decisões de negócio confirmadas (CEO)
- **Trilha de admissão/onboarding 1→11** validada (ver diagrama/artifact e SPEC). Subfluxo de compra vinculado; **UX: mesma aba com retorno + protocolo automático**.
- **D1 Diretoria** = super-papel (vê tudo, intervém, maior alçada, edita parâmetros financeiros); ADMIN administra a aplicação.
- **D2/Parâmetros Financeiros**: **teto mensal por setor = cadastro MANUAL**; **consumido/saldo = automático** (teto − compras/pagamentos *deferidos* do setor no mês) **com override manual**; editores = **ADMIN, Diretoria, Líder I do Financeiro**; toda edição manual **auditada**.
- **D3/D6 Organização**: setor tem **Líder I** (1, obrigatório/único), **Líder II** (0..n), **Membro** (0..n; reporta a Líder II ou direto Líder I). Visibilidade: Membro só os próprios; Líder II próprios+seus Membros; Líder I todo o setor; Diretoria/ADMIN tudo. **20 setores** definidos. Funções de fluxo: TI/DADOS/SISTEMAS (setor "TI, Dados e Infra"), ADMINISTRATIVO, RH, FINANCEIRO, DIRETORIA; qualquer setor é Solicitante.
- **Roteamento de aprovação (compra/pagamento)**: dentro do teto **E** com previsão **E** com saldo no mês → Membro do Financeiro; senão → Líder I do Financeiro → pode deferir/indeferir/solicitar correção/solicitar info/encaminhar à Diretoria.
- **Ações de aprovação** (a construir): deferir / indeferir / solicitar correção / solicitar informação complementar / encaminhar.
- **Roteamento de tarefa de função**: vai para fila da função (qualquer Membro assume; fallback Líder II → Líder I). Diretoria = fila.

## 5. Progresso
**Fase 0 (PR #10):** ✅1 papéis+20 setores · ✅2 hierarquia (Líder I/II/Membro + suplência) · ✅3 visibilidade (IDOR de leitura FECHADO) · ✅4 mascaramento CPF/RG/salário (LGPD: motor+política+auditoria; *no-op* até o Passo 7) · ✅5 ações de aprovação ricas (decision/resubmit + rounds; FORWARD só p/ alçada/Diretoria) · ✅6 filas de função (fan-out + claim; fallback Membro→Líder II→Líder I) · ✅7 campos dinâmicos (FormField/RequestFieldValue; ATIVA o mascaramento LGPD do P4) · ✅8 subtarefas/checklist (condicional + gating; `applicable` server-side) · ✅9 subfluxo pai↔filho (parentRequestId + protocolo; sem auto-gating) · ✅10 status customizados (statusLabel denormalizado) · ✅11 escalonamento temporal (estágios 2/3/7d + justificativa; líder p/ level LIDER_1) · ✅12 Parâmetros Financeiros (teto/consumo/override + decidePaymentRouting) · ✅13 suplência (gestão da delegação + efetiva no gate financeiro). **FASE 0 COMPLETA.**
**Fase 1 — Trilha de Onboarding (espinha dorsal, PR #10):** ✅ trilha 1→11 montada por CONFIGURAÇÃO (seed `seedOnboardingFlow`) sobre os primitivos da Fase 0 — branch nova-vaga(Diretoria)/substituição(RH direto), etapas paralelas (40: TI∥ADM; 70: TI∥SISTEMAS∥ADM∥DADOS), campos PII mascarados (CPF/RG), checklists condicionais, statusLabels. Fila de função tornada **precisa por função** (setor multifunção TI/DADOS/SISTEMAS). E2E ponta a ponta 22/22.
**Fase 1 — FRONTEND (telas da trilha, PR #10):** ✅ entregue e verificado com screenshots reais (Chromium). Identidade **Gol Plus** (cores/fontes/Logo), **zero "SGA"**. Telas: abertura de vaga com **form dinâmico** (campos da etapa 0), Minhas Tarefas com **"Assumir"** (claim), Detalhe com aba **Trilha** (checklist por etapa, paralelas, só itens aplicáveis), **PII mascarada por papel** (RH vê CPF/RG; TI vê `***`), painel de **decisão rica**, reenvio, compras vinculadas; `statusLabel` no acompanhamento. `frontend` build verde.
**Ajustes cosméticos do frontend:** ✅ resolvidos (`a85706a`) — progresso compara por `order` e distingue concluída/PULADA/pendente; "Etapa atual" mostra "&lt;etapa&gt; — passo K de N".
**Pendente da trilha (backend):** ramos de devolução completos (2.1/2.2), condicional fina de step (DADOS só se PowerBI). *(Subfluxo de compra na etapa 5 = disparo manual já suportado.)*
**Utilitário:** `backend/scripts/demo-data.mjs` popula uma solicitação da trilha caminhada (p/ demo do piloto).
**Pagamentos (PR #9):** backend+frontend+scheduler entregues. Pendente: edição completa de recorrência na UI; ligar FinanceParams real (`decidePaymentRouting` já existe na Fase 0); etapa inicial de aprovação do líder.
**Prioridades de lançamento:** 1) requisição de vaga + trilha completa de onboarding · 2) compra (subfluxo) + pagamento · 3) offboarding · 4) inventário conectado.

## 6. Segurança
- IDOR de leitura **fechado** via visibilidade por setor (`lib/visibility.ts`): não-envolvido → 403; escopo respeitado na lista. Upload inválido → 400. Segregação de funções (iniciador nunca aprova o próprio) preservada.
- Pagamentos: matriz de 40+ casos (IDOR, alçada/centavos, replay/concorrência, JWT, anexos) — ver PAGAMENTOS-SECURITY.md (na branch do Pagador).

## 7. Pendências do CEO (não bloqueiam o build)
- **Renomear o repositório** no GitHub: `aureliofaria/sga` → `aprova` (Settings) e a **descrição** "SGA TEST". Não consigo via API.
- Excluir branches antigas obsoletas pela UI.
- (Opcional) confirmar assunções residuais do SPEC Parte V (mascaramento por campo já encaminhado; importação em massa de setores na implantação).

## 8. Gotchas técnicos (importante)
- **Prisma Client é hoisted no `node_modules` compartilhado** da raiz — worktrees de agentes podem regenerá-lo contra outro schema. **Sempre `npm run db:generate -w backend` a partir do schema da branch** antes de build/test. CI roda isolado (faz db:generate) — não afetado.
- **E2E exige reseed limpo** do `dev.db` (rm dev.db; db:deploy; db:seed) — senão ativos de inventário já consumidos fazem checks falharem.
- `dev.db`, `.env`, `dist`, `node_modules` são gitignored. `seed.ts` semeia os 20 setores idempotentemente (vale em produção).
- Usuários demo (senha `senha123`): admin/rh/financeiro/gestor/joao @aprova.com. Seed demo vincula hierarquia em "TI, Dados e Infra" (gestor=Líder I, rh=Líder II, joao=Membro).

## 9. Como retomar
1. `git checkout claude/fase0-organizacao` · `npm install` · `npm run db:generate -w backend`.
2. Conferir este doc + `FASE0-CHECKLIST.md`. Próximo passo aberto = **Fase 0 · passo 4 (mascaramento CPF/RG)**.
3. Padrão: delegar a Motor (Opus p/ dado sensível) → Lupa → Maestro verifica (build + testes + e2e com reseed + sonda) → merge na branch da fase → atualizar checklist e este doc.
