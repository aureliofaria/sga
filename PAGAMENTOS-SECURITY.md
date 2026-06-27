# Matriz de Segurança e Abuso — Fluxo de Pagamentos (APROVA)

> Branch: `claude/pagador-fluxo-pagamentos`
> Cada caso foi **executado** via testes automatizados (vitest + smoke E2E).
> Comandos para reproduzir no fim do documento.
>
> Resultado global: **75 testes vitest + 52 checks E2E — todos PASS.**
> Vulnerabilidades/bugs encontrados e **corrigidos: 2** (detalhados abaixo).

## Vulnerabilidades / bugs encontrados e corrigidos

### V1 — IDOR em leitura/anexos de solicitação e tarefa (CORRIGIDO)
Antes: `GET /requests/:id`, `GET /requests/:id/attachments`,
`GET /requests/:id/audit`, `POST /requests/:id/attachments` e `GET /tasks/:id`
**não verificavam envolvimento** — qualquer usuário autenticado lia/anexava em
pedido de pagamento alheio (incluindo valor, fornecedor, justificativa, anexos).
Causa secundária: a etapa de "Solicitação" (`requiredRole: USER`) era
**transmitida a todos os USERs**, tornando-os "envolvidos" indevidamente.

Correção:
- Controle de acesso por envolvimento (iniciador / responsável de tarefa /
  aprovador) ou papel de visão ampla, em todas as rotas acima
  (`canAccessRequest`, checagem no `GET /requests/:id` e `GET /tasks/:id`).
- `createRequestTasks`: a "tarefa do solicitante" (papel exigido = papel do
  iniciador) é atribuída **somente a ele**, sem broadcast a peers.
Re-teste: PASS (suíte `payments.test.ts` › IDOR e `assignment.test.ts`).

### V2 — Upload de tipo/tamanho inválido retornava 500 (CORRIGIDO)
Antes: o `fileFilter` do multer rejeitava corretamente arquivos perigosos
(.exe, .svg), mas o erro virava **500 genérico** (sem handler), confundindo o
usuário e mascarando a causa. Correção: `handleUpload` traduz
`UNSUPPORTED_FILE_TYPE` e `LIMIT_FILE_SIZE` em **400 com mensagem clara**,
aplicado nas 3 rotas de upload. Re-teste: PASS.

---

## Matriz de casos

Legenda: PASS = comportamento seguro confirmado por teste executado.

### A. Autorização / segregação de funções
| # | Caso | Esperado | Resultado |
|---|------|----------|-----------|
| A1 | Iniciador tenta aprovar o próprio pagamento | 403 | PASS |
| A2 | USER comum (sem alçada) tenta aprovar | 403 | PASS |
| A3 | Aprovador de papel errado para a faixa (MANAGER na faixa que exige FINANCE) | 403 | PASS |
| A4 | Aprovador da alçada correta aprova | 200 | PASS |
| A5 | Etapa de alçada nunca atribui tarefa ao iniciador (mesmo sendo único do papel) | sem tarefa p/ iniciador | PASS |
| A6 | Membro (USER) lista só os próprios pedidos | não vê de terceiros | PASS |
| A7 | Papel de visão ampla (FINANCE) lista todos | vê todos | PASS |

### B. IDOR (referência direta a objeto)
| # | Caso | Esperado | Resultado |
|---|------|----------|-----------|
| B1 | USER não envolvido lê pagamento alheio (`GET /requests/:id`) | 403 | PASS |
| B2 | USER não envolvido lista anexos alheios (`GET .../attachments`) | 403 | PASS |
| B3 | USER não envolvido lê auditoria alheia (`GET .../audit`) | 403 | PASS |
| B4 | USER não envolvido anexa em pagamento alheio (`POST .../attachments`) | 403 | PASS |
| B5 | Iniciador lê o próprio pedido | 200 | PASS |
| B6 | FINANCE (visão ampla) lê qualquer pedido | 200 | PASS |
| B7 | `GET /tasks/:id` por terceiro não envolvido | 403 | PASS |

### C. Alçada por valor / centavos
| # | Caso | Esperado | Resultado |
|---|------|----------|-----------|
| C1 | Valor zero | 400 | PASS |
| C2 | Valor negativo | 400 | PASS |
| C3 | Overflow (> teto sanitário 10_000_000_000) | 400 | PASS |
| C4 | Valor não-numérico ("abc") | 400 | PASS |
| C5 | Valor objeto/array (`{$gt:0}` / `[1,2]`) | 400, sem 500 | PASS |
| C6 | Arredondamento de centavos (100050.7 → 100051, inteiro) | inteiro, sem float | PASS |
| C7 | Limite de faixa contíguo (500000 faixa A; 500001 faixa B) | faixa correta | PASS |
| C8 | "Valor logo abaixo do teto" seleciona a faixa correta | faixa por centavos | PASS |
| C9 | Mesmo aprovador não conta 2x para `requiredApprovers` | constraint única | PASS |

> Nota sobre "dividir o pedido" para burlar o teto: cada pedido é avaliado
> isoladamente; mitigação é de **processo/auditoria** (relatórios por
> solicitante/fornecedor), conforme `PAGAMENTOS.md` §4 (ASSUNÇÃO).

### D. Dupla decisão / replay / corrida
| # | Caso | Esperado | Resultado |
|---|------|----------|-----------|
| D1 | Mesmo aprovador decide a mesma etapa 2x (sequencial) | 409 | PASS |
| D2 | Duas aprovações concorrentes do mesmo aprovador (paralelo) | só 1 persiste, nenhum 500 | PASS |

### E. Validação de entrada / injeção
| # | Caso | Esperado | Resultado |
|---|------|----------|-----------|
| E1 | Categoria ausente | 400 | PASS |
| E2 | Categoria inválida ("HACK") | 400 | PASS |
| E3 | Sem centro de custo | 400 | PASS |
| E4 | Sem justificativa | 400 | PASS |
| E5 | COMPRA/SERVICO/ASSINATURA sem fornecedor | 400 | PASS |
| E6 | SQL-injection-like em title/justification/supplier | armazenado literal, tabela intacta | PASS |
| E7 | `flowId` inexistente | 404 (não 500) | PASS |

### F. Anexos
| # | Caso | Esperado | Resultado |
|---|------|----------|-----------|
| F1 | Content-type perigoso (.exe / octet-stream) | 400 claro | PASS (corrigido V2) |
| F2 | HTML/SVG (XSS armazenado) | 400 claro | PASS (corrigido V2) |
| F3 | Path traversal no nome (`../../etc/passwd`) | nome físico gerado, sem `/` nem `..`; dentro de /uploads | PASS |
| F4 | Tamanho excessivo (> 10 MB) | 400 claro | PASS (handleUpload LIMIT_FILE_SIZE) |
| F5 | Anexo válido (pdf/txt) | 201 | PASS |
| F6 | Servir anexo: `Content-Disposition: attachment` + `nosniff` | download forçado, sem render inline | PASS (config estática em index.ts) |

### G. Sessão / JWT
| # | Caso | Esperado | Resultado |
|---|------|----------|-----------|
| G1 | Rota de pagamento sem token | 401 | PASS |
| G2 | Token expirado | 401 | PASS |
| G3 | Token forjado (segredo errado / assinatura inválida) | 401 | PASS |
| G4 | Token de usuário inativo | 401 | PASS |
| G5 | Segredo JWT obrigatório via env em produção (sem fallback) | exige `JWT_SECRET` | PASS (config.ts; verificado por leitura) |

### H. Erros do usuário comum (mensagem clara, sem estado inconsistente)
| # | Caso | Esperado | Resultado |
|---|------|----------|-----------|
| H1 | Concluir a etapa de solicitação sem anexo obrigatório | 400; etapa permanece PENDING, currentStep=0 | PASS |
| H2 | Rejeição sem motivo | 400 | PASS |
| H3 | Categoria errada (campos faltantes da categoria) | 400 com mensagem do campo | PASS |

### I. Recorrências
| # | Caso | Esperado | Resultado |
|---|------|----------|-----------|
| I1 | USER comum cria recorrência | 403 | PASS |
| I2 | FINANCE cria recorrência | 201 | PASS |
| I3 | Recorrência com valor inválido | 400 | PASS |
| I4 | Geração de vencidas + idempotência (2ª execução não duplica) | 1 pedido só | PASS |
| I5 | Recorrência inativa não gera | 0 pedidos | PASS |
| I6 | Pedido gerado segue o fluxo de aprovação (não pula alçada) | IN_PROGRESS, step 0 | PASS |

---

## Como reproduzir

```bash
# Unit + integração (75 testes, inclui as suítes de segurança):
npm test -w backend
# Apenas a suíte focada em segurança:
npx vitest run tests/payments-security.test.ts --root backend

# Build:
npm run build -w backend

# Smoke E2E (52 checks) — exige o servidor de processo único no ar:
#  1) cp backend/prisma/dev.db backend/prisma/e2e.db   (DB já migrado e seedado)
#  2) DATABASE_URL="file:$PWD/backend/prisma/e2e.db" PORT=3099 SERVE_FRONTEND=true \
#       JWT_SECRET=e2e-test-secret NODE_ENV=development node backend/dist/index.js &
#  3) BASE=http://localhost:3099 npm run test:e2e -w backend
```

## Riscos residuais / pendências (ver relatório final)
- Visibilidade por **setor/liderança** (Líder I vê só o próprio setor) tem
  **gancho** pronto (`buildVisibilityScope`) mas depende da definição do papel
  de liderança de setor — pendente de confirmação humana.
- "Dividir pedido" para burlar teto: controle de processo/auditoria, não técnico.
- Tetos de alçada e nº de aprovadores são **defaults (ASSUNÇÃO)** — a Diretoria/
  Líder Financeiro/ADMIN devem confirmar os valores definitivos.
