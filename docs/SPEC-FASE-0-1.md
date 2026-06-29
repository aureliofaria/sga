# APROVA — Especificação Fase 0 (Organização & Acessos) + Fase 1 (Trilha de Admissão/Onboarding)

> Documento para **revisão e aprovação** antes da construção. Linguagem de negócio + modelo de dados em termos claros. Tudo marcado **[NOVO]** ainda não existe no sistema e será construído.

---

## Parte I — FASE 0 · Fundação (Organização & Acessos)

A Fase 0 é pré-requisito de tudo. Ela entrega o modelo de organização, o controle de acesso e as capacidades de motor que a trilha de onboarding (e os fluxos de compra/pagamento) exigem.

### 1. Setores
- O **ADMIN** cria/edita Setores nas Configurações do APROVA.
- **20 setores** iniciais: TI, Dados e Infra · Administrativo · RH · Financeiro · Sinistros · Assistência 24H · SAC e Ouvidoria · Cobrança · Comercial Interno · Aceleração de Expansão · Jurídico · Monitoramento e Gestão de Risco · Cadastro · Marketing · Processos · Central de Atendimento · Controladoria · Diretoria · Gestão de Prestadores · Retenção.

### 2. Hierarquia dentro do setor (eixo "posição")
- **Líder I** — **exatamente 1 por setor** (obrigatório, único). A mesma pessoa pode ser Líder I de vários setores. *(Invariante garantida no banco e na tela.)*
- **Líder II** — opcional, 0..n por setor.
- **Membro** — opcional, ilimitado. Cada Membro é vinculado **a um Líder II** ou **direto ao Líder I**.
- **[NOVO] Suplência do Líder I:** o Líder I pode **delegar** a um Líder II por um período (ausência/férias), para o setor não travar. *(Não existe hoje — confirmado por inspeção do código.)*

### 3. Funções nos fluxos (eixo "função" — independente da posição)
- Setor **TI, Dados e Infra** concentra **3 funções distintas**: **TI**, **DADOS**, **SISTEMAS**.
- **Administrativo → ADMINISTRATIVO** · **RH → RH** · **Financeiro → FINANCEIRO** · **Diretoria → DIRETORIA**.
- **Solicitante**: qualquer setor pode abrir requisições (vaga, desligamento, compra, pagamento). Só alguns setores possuem função nos fluxos.
- Uma pessoa tem **uma posição** (Líder I/II/Membro) **e**, quando aplicável, **uma função**. **[NOVO]** papéis TI/DADOS/SISTEMAS/ADMINISTRATIVO/DIRETORIA (hoje só existem ADMIN/HR/FINANCE/MANAGER/USER).

### 4. Visibilidade (acesso aos pedidos/tarefas)
- **Membro:** vê só os pedidos que ele abriu; e, do lado de execução, só as tarefas **da sua função**.
- **Líder II:** os próprios (como solicitante) + pedidos/tarefas em atendimento por ele ou seus Membros.
- **Líder I:** **todos e somente** os pedidos do seu Setor (Líder II + Membros) + tarefas em execução por alguém do setor.
- **Diretoria / ADMIN:** tudo, com poder de **intervenção** a qualquer momento.
- **[NOVO] Mascaramento por campo (LGPD):** dados sensíveis (CPF, RG, salário) visíveis só para quem precisa (ex.: **TI não vê CPF/RG**; Administrativo vê só 5 campos).

### 5. Roteamento de aprovação (genérico, reutilizado por todos os fluxos)
**Lado origem (quem abre):** Membro → (Líder II, se vinculado) → **Líder I** do setor de origem (aprecia/edita/complementa).
**Lado destino (função/decisão):** conforme a regra de cada fluxo (ver Parte II e III).
**[NOVO] Ações em cada etapa de aprovação:** **deferir · indeferir · solicitar correção · solicitar informação complementar · encaminhar** (hoje só existe aprovar/reprovar).
**Filas (decisão #3 e #4):**
- Tarefa de **função** vai para uma **fila da função** — qualquer Membro daquela função pode **assumir**; **fallback**: se não houver Membro, vai ao Líder II; se não houver, ao Líder I.
- Aprovação da **Diretoria** = **fila** (qualquer diretor aprova).

### 6. Parâmetros Financeiros (Configurações)
- **[NOVO]** Tela de **Parâmetros Financeiros**, editável por **Diretoria, Líder Financeiro e ADMIN**:
  - **Tetos de alçada** (por setor/centro de custo).
  - **Previsão orçamentária mensal** por setor/centro de custo e **classe**.
  - Estes parâmetros alimentam o roteamento de compra/pagamento (Parte III).

### 7. Capacidades de motor a construir nesta fase **[NOVO]**
1. **Campos dinâmicos por etapa/fluxo** (formulários configuráveis) — o schema fixo de hoje não comporta CPF/RG/e-mail/orçamentos etc.
2. **Subtarefas/checklist com "conclui só quando todas validadas"**.
3. **Subtarefas condicionais** (telefone, VOIP, celular, PowerBI).
4. **Subfluxo pai↔filho** (compra vinculada ao pedido da vaga).
5. **Status customizados** ("Seleção em andamento", "Preparar onboarding").
6. **Agendador de escalonamento por tempo** (2º/3º/7º dia) + **justificativa de atraso**.
7. **Ações de aprovação ricas** (deferir/indeferir/corrigir/info/encaminhar) + devolução ao solicitante com reenvio.
8. **Delegação/suplência** do Líder I.
9. **Mascaramento de campos** por função.

### 8. Impacto no modelo de dados (resumo)
- **Sector** (existe) + **SectorMember** (evoluir): `level` ∈ {LIDER_1, LIDER_2, MEMBRO}, `reportsToMemberId` (Membro→Líder II/Líder I), `delegateToMemberId`+`delegateUntil` (suplência). Constraint: 1 LIDER_1 por setor.
- **Role** (enum): estender com TI, DADOS, SISTEMAS, ADMINISTRATIVO, DIRETORIA (manter os atuais).
- **FormSchema/FormField** [NOVO]: campos por etapa, com flag de sensibilidade (mascaramento).
- **Subtask** [NOVO]: itens de checklist por tarefa, com condição de exibição.
- **Request.parentRequestId** [NOVO]: subfluxo.
- **EscalationRule** [NOVO] + **DelayJustification** [NOVO].
- **FinanceParams** [NOVO]: tetos + previsão mensal por setor/centro de custo/classe.

---

## Parte II — FASE 1 · Trilha de Admissão / Onboarding (etapas 1→11)

Mapa por etapa (alinhado ao diagrama de validação e às decisões D1–D6 / 1–4):

| # | Quem | O quê | Campos / Regras | Novo? |
|---|------|-------|------------------|-------|
| 1 | Solicitante (Membro/Líder de qualquer setor) | Abre o pedido de vaga | setor, líder, equipamentos/softwares, **itens condicionais** (telefone/VOIP/celular/PowerBI) | parcial |
| 2 | Decisão por tipo | 2.1 Nova vaga → **Diretoria** (defere→RH / indefere→devolve); 2.2 Substituição/Promoção/Troca de setor → **RH** | branch por `vacancyType` (vale inclusive p/ pedido aberto pelo Líder I) | motor já suporta branch |
| 3 | RH | Avalia; indefere→devolve; defere→informa **prazo** e dispara TI ∥ Administrativo | campo **prazo** | [NOVO] campo |
| 4 | TI ∥ Administrativo (paralelo) | Avaliação inicial com **visibilidade segregada** (TI: vaga/equip./prazo; ADM: só itens admin.) | mascaramento por função | [NOVO] |
| 5 | TI / ADM | Decisão **comprar × estoque**: estoque→provisiona/separa; comprar→**abre subfluxo de compra vinculado** → Financeiro | subfluxo pai-filho; botão "abrir compra" | [NOVO] |
| 6 | RH (acompanha) | Status **"Seleção em andamento / TI e ADM notificados"**; painel de acompanhamento | status custom | [NOVO] |
| 7 | RH | **"Preparar onboarding"**: informa nome, **CPF, RG**, e-mail particular, data início | form por status; PII mascarável | [NOVO] |
| 8 | TI ∥ SISTEMAS ∥ DADOS(condicional) ∥ Administrativo | Execução com **checklists**; cada área conclui só com **todas** as subtarefas; **subtarefas condicionais**; follow-up "dia seguinte" | checklist + gating; DADOS só se PowerBI pedido; TI sem CPF/RG; ADM só 5 campos | [NOVO] |
| 9 | RH/Solicitante/Diretoria | Notificações de conclusão + **escalonamento por tempo** (2º dia→solicitante; 3 dias→líder; 7 dias→diretoria) | agendador temporal | [NOVO] |
| 10 | Área atrasada | **Justifica o atraso** para cada notificação enviada | justificativa vinculada | [NOVO] |
| 11 | — | Onboarding **100% concluído** | — | — |

**Telas da Fase 1:** abertura com itens condicionais · painel de acompanhamento do RH · telas de checklist por função · formulário "Preparar onboarding" (PII) · tela de justificativa/escalonamento · subfluxo de compra na **mesma aba** com retorno e **protocolo preenchido automaticamente** (decisão D5).

---

## Parte III — Como Compra e Pagamento se conectam (Prioridade 2 / Pagador)

A mesma governança da Fase 0 rege compra e pagamento:

- **Aprovação de origem:** Membro → (Líder II) → Líder I do setor solicitante.
- **Roteamento financeiro (decisão #2):**
  - **SE** (dentro do teto de alçada **E** tem previsão orçamentária **E** ainda há orçamento no mês) **→ Membro do Financeiro** executa.
  - **SENÃO → Líder I do Financeiro**, que pode **deferir / indeferir / solicitar correção / solicitar informação complementar / encaminhar à Diretoria**.
  - **Diretoria** pode deferir / indeferir / solicitar correção / solicitar informação complementar.
- **Compra (subfluxo da vaga):** protocolo existente? · escopo (só esta vaga / outras / mais necessidades) · previsão (centro de custo + classe / análise) · **3 orçamentos** (fornecedor, frete, formas de pagamento, parcelas, prazos…) · monitorar recebimento.
- **Estado do Pagador:** já entregou backend de categorias/recorrência/alçada + **endurecimento de segurança** (PR #9), com `buildVisibilityScope` (gancho) e sequência de aprovação **flexível** — exatamente o que este roteamento exige. Falta: **plugar os Parâmetros Financeiros** (tetos + previsão mensal) e a **visibilidade por setor/liderança** desta Fase 0, além do **frontend** e do **cron** de recorrências.

---

## Parte IV — Plano de execução (fatiamento)

1. **Fase 0** (fundação): setores + hierarquia + funções + visibilidade + ações de aprovação + campos dinâmicos + subtarefas + subfluxo + escalonamento + parâmetros financeiros + delegação.
2. **Fase 1 — espinha dorsal**: caminho feliz 1→3→(4/5)→7→8→11, sem ramos opcionais.
3. **Fase 1 — completar**: ramificações 2.1/2.2, segregação por campo, condicionais, escalonamento/justificativa.
4. **Prioridade 2** (Pagador): finalizar pagamento + compra com os parâmetros financeiros e a visibilidade desta fundação; frontend.
5. **Prioridade 3** (offboarding) e **4** (inventário conectado).

---

## Parte V — Assunções a confirmar
- **Mascaramento por campo:** quais campos sensíveis e quem vê cada um (proposta: CPF/RG/salário só RH+Diretoria; TI/SISTEMAS/DADOS/ADM não veem CPF/RG).
- **"Orçamento do mês":** como é medido (soma de pedidos deferidos no mês vs. teto do setor/centro de custo).
- **Pedido aberto por quem JÁ é função-destino** (ex.: Membro do Financeiro abre um pagamento) — segue a cadeia de origem normalmente e o roteamento financeiro se aplica a partir daí.
- **Importação em massa** de setores/usuários/hierarquia (CSV) na implantação — recomendado.
