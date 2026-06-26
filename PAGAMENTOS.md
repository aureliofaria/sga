# Fluxo de Pagamentos — APROVA

> Especificação do fluxo-alvo de **Pagamentos** (todos os pedidos enviados ao
> Financeiro: compras, serviços, assinaturas, recorrências, salários e
> reembolsos). Documento vivo — base do piloto de 01/07/2026.
>
> Branch: `claude/pagador-fluxo-pagamentos`

---

## 1. Diagnóstico — o que já existe

O APROVA já tem um **motor de workflow genérico** sólido e reutilizável:

| Componente | Estado | Observação |
|---|---|---|
| `FlowTemplate` / `FlowStep` / `AuthorizationLevel` | OK | Etapas ordenadas, alçada por faixa de valor (centavos), ramificação por condição. |
| `Request` (com `amountCents`, `supplier`, `costCenter`, `justification`) | OK | Valores em **inteiros de centavos** (sem float). |
| `Approval` com `@@unique([requestId, stepOrder, approverId])` | OK | Impede dupla decisão do mesmo aprovador (replay). |
| Segregação de funções (`authorizeDecision`) | OK | Iniciador nunca decide a própria solicitação (403). |
| Avanço atômico (`advanceRequest`) | OK | Transação + guarda otimista por `currentStep` (corrida). |
| Alçada por valor (`isStepComplete` / `checkAuthorizationLevel`) | OK | Seleção de faixa por centavos. |
| Anexos (`Attachment`) + upload | OK | Whitelist de MIME/extensão, limite 10 MB, servido como `attachment` + `nosniff`. |
| `AuditLog` | OK | Trilha imutável por solicitação. |
| Fluxo `PAYMENT` no seed | **Genérico** | Uma única forma; **sem categoria**, sem campos obrigatórios por tipo, **sem recorrência**. |

### Lacunas encontradas (vs. necessário)

1. **Sem categorização de pagamento.** Compra, serviço, assinatura, salário e
   reembolso têm exigências distintas (campos e anexos) — hoje todos caem no
   mesmo formulário sem validação específica.
2. **IDOR (prioridade de segurança).** `GET /requests/:id`,
   `GET /requests/:id/attachments`, `GET /requests/:id/audit`,
   `POST /requests/:id/attachments` e `GET /tasks/:id` **não verificavam
   envolvimento** — qualquer usuário autenticado lia/anexava em pedido alheio.
3. **Validação de valor frouxa para pagamentos.** `parseCents` aceita zero,
   negativos e valores absurdos; pagamento exige `> 0` e teto sanitário.
4. **Iniciador podia receber a tarefa de aprovação** quando não havia outro
   usuário do papel aprovador (fallback para o iniciador) — fura a segregação.
5. **Sem pagamentos recorrentes** (geração periódica de pedidos).

---

## 2. Categorias de pagamento

`Request.paymentCategory` (string, obrigatório quando `flow.type = 'PAYMENT'`):

| Categoria | Código | Descrição |
|---|---|---|
| Compra | `COMPRA` | Aquisição de bens/materiais. |
| Serviço | `SERVICO` | Prestação de serviço pontual. |
| Assinatura | `ASSINATURA` | Licença/SaaS de cobrança periódica. |
| Recorrência | `RECORRENCIA` | Pagamento periódico genérico (aluguel, utilities). |
| Salário | `SALARIO` | Folha / pró-labore. |
| Reembolso | `REEMBOLSO` | Ressarcimento de despesa adiantada por colaborador. |

### 2.1 Campos obrigatórios por categoria

Todos exigem: `title`, `amountCents` (> 0), `costCenter`, `justification`.
Adicionalmente:

| Categoria | Campos obrigatórios extras | Anexo obrigatório na criação |
|---|---|---|
| `COMPRA` | `supplier` | Nota fiscal / orçamento (1+) |
| `SERVICO` | `supplier` | Contrato ou nota de serviço (1+) |
| `ASSINATURA` | `supplier` | Comprovante/contrato da assinatura (1+) |
| `RECORRENCIA` | `supplier` | Contrato base (1+) |
| `SALARIO` | — | Folha/holerite (1+) |
| `REEMBOLSO` | — | **Comprovante de despesa (obrigatório)** |

> A obrigatoriedade de anexo é dupla: validada **na finalização da etapa 0**
> (categoria) e reforçada na etapa de processamento
> (`FlowStep.requiresAttachment`). Como a criação e o upload de anexos são duas
> chamadas HTTP distintas, o pedido é criado e a exigência de anexo é cobrada ao
> **concluir a etapa de solicitação** (etapa 0). Categorias que exigem anexo
> têm a etapa 0 marcada com `requiresAttachment = true` no seed.

---

## 3. Etapas e papéis

Fluxo-alvo (`type = PAYMENT`), preservando o motor existente:

```
Etapa 0 — Solicitação            (requiredRole: USER)   → solicitante detalha o pedido + anexos
Etapa 1 — Aprovação por alçada   (AuthorizationLevel)   → aprovador conforme o valor
Etapa 2 — Processamento Financeiro (FINANCE, requiresAttachment) → baixa/comprovante
```

- **Solicitante** (qualquer papel com permissão `PAYMENT`) abre o pedido.
- **Aprovador** é definido pela **alçada por valor** (faixas em centavos).
- **Financeiro** processa e anexa o comprovante de pagamento.

### Segregação de funções (regra inviolável)

- O **iniciador nunca aprova/decide** o próprio pedido → **403**
  (`authorizeDecision`).
- O iniciador **nunca recebe a tarefa de aprovação** mesmo que seja o único
  usuário do papel aprovador — etapas com alçada (`authLevels`) **não fazem
  fallback** para o iniciador; a etapa fica aguardando um aprovador válido
  (ver `createRequestTasks`).
- ADMIN pode decidir (override operacional), **exceto** o próprio pedido.

---

## 4. Alçada por valor

Faixas (`AuthorizationLevel`, em **centavos inteiros**) — default do piloto:

| Faixa | Valor (R$) | minValueCents | maxValueCents | Aprovadores | Papel |
|---|---|---|---|---|---|
| A | até 5.000,00 | 0 | 500000 | 1 | MANAGER |
| B | 5.000,01 – 50.000,00 | 500001 | 5000000 | 1 | FINANCE |
| C | acima de 50.000,00 | 5000001 | null | 2 | ADMIN |

> **ASSUNÇÃO (decisão de negócio):** tetos e nº de aprovadores acima são
> defaults razoáveis. A definição final (por setor/centro de custo) é do humano.

### Ganchos para parametrização futura

- `AuthorizationLevel` já é por `FlowStep`, logo **por fluxo**. Para variar por
  **centro de custo / setor / teto**, o gancho previsto é: criar fluxos PAYMENT
  distintos por setor **ou** estender `AuthorizationLevel` com `costCenter?` e
  `sectorId?` opcionais (campos aditivos). Documentado como trabalho futuro;
  **não implementado** neste piloto para não inflar o schema.
- A seleção de faixa por centavos é robusta a erros de arredondamento: os
  limites são inclusivos e contíguos (…500000 | 500001…), sem zona morta.

### Anti-burla de alçada

- Valor **sempre** em centavos inteiros; `parseCents` rejeita não-numérico.
- Pagamento exige `amountCents > 0` e `<= TETO_SANITARIO`
  (R$ 100.000.000,00 = 10_000_000_000 centavos) — barra zero, negativo e overflow.
- "Dividir o pedido" para ficar abaixo do teto é mitigado por **controle de
  processo/auditoria** (relatórios por solicitante/fornecedor) — ASSUNÇÃO.

---

## 5. Pagamentos recorrentes

Modelo `PaymentRecurrence`:

- `flowId`, `initiatorId`, `paymentCategory`, `amountCents`, `supplier`,
  `costCenter`, `justification`, `title`.
- `intervalUnit` (`MONTH` | `WEEK`) + `intervalCount`.
- `nextRunAt`, `isActive`, `lastRunAt?`.

Geração: serviço `generateDueRecurrences()` cria um `Request` PAYMENT para cada
recorrência ativa com `nextRunAt <= agora`, dispara as tarefas da etapa 0 e
avança `nextRunAt`. Idempotente por janela (guarda otimista por `nextRunAt`, não
duplica no mesmo período sob concorrência). Disparável manualmente por
ADMIN/FINANCE (`POST /api/payments/recurrences/run`) e por cron futuro. O pedido
gerado segue o **mesmo fluxo de aprovação** — recorrência não pula alçada.

---

## 6. Estados e retorno ao solicitante

| Status | Significado |
|---|---|
| `IN_PROGRESS` | Em tramitação (criado/aprovado parcialmente). |
| `COMPLETED` | Pago/processado pelo Financeiro. |
| `REJECTED` | Recusado (motivo obrigatório, notifica o solicitante). |
| `RETURNED` | Devolvido por SLA expirado (ajuste pelo solicitante). |
| `CANCELLED` | Cancelado pelo iniciador/ADMIN. |

O solicitante é **notificado** em conclusão e rejeição (`Notification`), e toda
transição fica na **trilha de auditoria** (`AuditLog`).

---

## 7. Segurança (resumo — detalhe em `PAGAMENTOS-SECURITY.md`)

- Controle de acesso por **envolvimento** (iniciador, responsável de tarefa,
  aprovador) ou papel privilegiado (ADMIN/MANAGER/FINANCE/HR) em leitura/anexos.
- Segregação de funções reforçada na atribuição e na decisão.
- Validação estrita de valor (centavos inteiros, > 0, teto).
- Anexos: whitelist, limite de tamanho, `Content-Disposition: attachment`,
  `nosniff`, nomes de arquivo gerados (sem path traversal).
- Auth: JWT obrigatório em todas as rotas de pagamento; segredo só via env em
  produção.
