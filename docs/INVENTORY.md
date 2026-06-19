# Módulo de Inventário — APROVA

Registro e rastreamento patrimonial de itens de **TI** e **Administrativo**: hardware,
periféricos, smartphones, chips (linhas telefônicas), mobiliário e afins. Mantém o histórico
completo de compras e movimentações, indicando a todo momento se o item está **disponível**,
**em posse de um usuário** (registrando quem) ou **alocado a um setor** (registrando qual).

## Modelo de dados

```
InventoryItem (catálogo)  1───*  Asset (unidade física)  1───*  AssetMovement (log imutável)
                                   │
                                   ├── Warehouse   (local de guarda quando não alocado)
                                   ├── Department  (setor responsável atual)
                                   └── User        (usuário em posse atual)

InventoryCount (contagem física)  1───*  InventoryCountItem  *───1  Asset
```

### InventoryItem — catálogo de tipos/modelos
| Campo | Descrição |
|-------|-----------|
| `code` | código único do item de catálogo |
| `name` | nome |
| `type` | `TI` \| `ADMINISTRATIVO` |
| `category` | `HARDWARE` \| `PERIFERICO` \| `SMARTPHONE` \| `CHIP` \| `MOBILIARIO` \| `OUTROS` |
| `brand`, `model`, `unit` | marca, modelo, unidade |
| `isActive` | soft delete |

### Asset — ativo físico individual (cada unidade patrimonial)
| Campo | Descrição |
|-------|-----------|
| `itemId` | referência ao catálogo |
| `tag` | nº de patrimônio / etiqueta (único) |
| `serialNumber`, `imei`, `phoneNumber` | série, IMEI (smartphone), linha (chip) |
| `status` | `DISPONIVEL` \| `ATIVO` \| `MANUTENCAO` \| `EMPRESTADO` \| `RESERVADO` \| `DESCARTADO` |
| `condition` | `NOVO` \| `BOM` \| `REGULAR` \| `RUIM` |
| `purchaseDate`, `supplier`, `invoiceNumber`, `invoiceValueCents` | dados da compra/NF |
| `warehouseId` | almoxarifado (quando não alocado a um setor) |
| `departmentId` | **setor onde está alocado** |
| `userId` | **usuário em posse** |
| `notes`, `isActive` | observações, soft delete |

### AssetMovement — log imutável de movimentações
Cada operação registra origem e destino, status anterior/novo, autor e data. **Nunca é editado.**

| `type` | Efeito no ativo |
|--------|-----------------|
| `ENTRADA` | cadastro inicial / compra |
| `ALOCACAO` | aloca a setor/usuário → `status=ATIVO` |
| `EMPRESTIMO` | empréstimo → `status=EMPRESTADO` |
| `DEVOLUCAO` | remove usuário → `status=DISPONIVEL` |
| `MANUTENCAO` | → `status=MANUTENCAO` |
| `RETORNO_MANUTENCAO` | → `status=DISPONIVEL` |
| `TRANSFERENCIA` | muda setor/usuário/almoxarifado |
| `DESCARTE` | → `status=DESCARTADO`, `isActive=false` |
| `AJUSTE_STATUS` | ajuste manual de status |

Campos de log: `fromDepartmentId`/`toDepartmentId`, `fromUserId`/`toUserId`,
`previousStatus`/`newStatus`, `reason`, `notes`, `createdById`, `movementDate`, e
`requestId` (vínculo opcional com o workflow APROVA).

### InventoryCount — contagem física
`status`: `RASCUNHO` → `EM_ANDAMENTO` → `CONCLUIDA` (ou `CANCELADA`). `type`: `GERAL` \|
`TI` \| `ADMINISTRATIVO` \| `SETOR`. Ao informar `departmentId` na criação, os ativos ativos
do setor são pré-carregados como itens da contagem.

## Endpoints (`/api/inventory`)

Todos exigem `Authorization: Bearer <token>`. Papéis: A=ADMIN, G=GESTOR, *=qualquer autenticado.

### Catálogo — `/items`
| Método | Rota | Papel | Descrição |
|--------|------|-------|-----------|
| GET | `/items?type=&category=&isActive=` | * | lista catálogo |
| GET | `/items/:id` | * | detalhe + ativos vinculados |
| POST | `/items` | A/G | cria (obrig.: code, name, type, category) |
| PUT | `/items/:id` | A/G | atualiza |
| DELETE | `/items/:id` | A | soft delete |

### Ativos — `/assets`
| Método | Rota | Papel | Descrição |
|--------|------|-------|-----------|
| GET | `/assets?type=&category=&status=&departmentId=&userId=&warehouseId=&search=&isActive=` | * | lista filtrada |
| GET | `/assets/:id` | * | detalhe completo + histórico |
| POST | `/assets` | A/G | cadastra ativo (gera movimentação `ENTRADA`) |
| PUT | `/assets/:id` | A/G | edita dados descritivos (não muda posse/status) |
| POST | `/assets/:id/movements` | * | **registra movimentação** (muda estado + grava log) |
| GET | `/assets/:id/movements` | * | histórico do ativo |

### Log global — `/movements`
| Método | Rota | Papel | Descrição |
|--------|------|-------|-----------|
| GET | `/movements?type=&assetId=&departmentId=&userId=&requestId=&from=&to=` | * | log global filtrável |

### Almoxarifados — `/warehouses`
| Método | Rota | Papel |
|--------|------|-------|
| GET `/warehouses` · GET `/warehouses/:id` | | * |
| POST · PUT · DELETE `/warehouses[/:id]` | | A |

### Contagens — `/counts`
| Método | Rota | Papel | Descrição |
|--------|------|-------|-----------|
| GET | `/counts?status=&type=&departmentId=` | * | lista |
| GET | `/counts/:id` | * | detalhe + itens |
| POST | `/counts` | A/G | cria (pré-popula por setor) |
| PUT | `/counts/:id` | A/G | atualiza status/notas (não retrocede) |
| POST | `/counts/:id/items` | A/G | adiciona ativo |
| PUT | `/counts/:id/items/:itemId` | * | registra resultado (`found`, `foundLocation`) |
| POST | `/counts/:id/start` · `/complete` | A/G | inicia / conclui |
| POST | `/counts/:id/cancel` | A | cancela |

## Exemplos

**Registrar compra de notebook:**
```http
POST /api/inventory/assets
{ "itemId": "<id>", "tag": "PAT-0001", "serialNumber": "SN123",
  "purchaseDate": "2026-06-01", "supplier": "Dell", "invoiceNumber": "NF-9988",
  "invoiceValueCents": 450000, "condition": "NOVO" }
```

**Entregar a um colaborador (posse + setor):**
```http
POST /api/inventory/assets/<id>/movements
{ "type": "ALOCACAO", "toUserId": "<userId>", "toDepartmentId": "<deptId>",
  "reason": "Entrega ao colaborador" }
```

**Devolução:**
```http
POST /api/inventory/assets/<id>/movements
{ "type": "DEVOLUCAO", "reason": "Desligamento" }
```

**Vincular movimentação a uma solicitação do workflow:**
```http
POST /api/inventory/assets/<id>/movements
{ "type": "TRANSFERENCIA", "toDepartmentId": "<deptId>", "requestId": "<requestId>" }
```
