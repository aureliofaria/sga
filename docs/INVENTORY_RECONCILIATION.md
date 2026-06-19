# Plano de Reconciliação de Inventário — APROVA

> Status: **proposta de design** (pré-merge). Define como o inventário leve já
> presente na base consolidada (`ResourceItem`/`RequestResource`) convive com o
> subsistema patrimonial da branch `claude/aprova-inventory-db-d2v3cr`
> (`Asset`/`Warehouse`/`InventoryItem`/`AssetMovement`/`InventoryCount`).
> Nenhum merge deve acontecer antes de decidir os itens em aberto da seção 8.

## 1. Princípio: duas camadas complementares (não duplicar)

As duas modelagens resolvem problemas **diferentes** e devem coexistir como camadas:

| Camada | Modelos | Pergunta que responde | Quando nasce |
|--------|---------|------------------------|--------------|
| **Intenção** (base atual) | `ResourceItem` + `RequestResource` | "De que esta *solicitação* precisa?" (checklist abstrato) | Na criação da solicitação |
| **Físico/patrimonial** (d2v3cr) | `InventoryItem` → `Asset` → `AssetMovement`; `Warehouse`; `InventoryCount` | "Qual *unidade física* foi entregue, onde está, e qual o histórico?" | No cumprimento da etapa |

Colapsar uma na outra seria um erro porque:

- `RequestResource` cobre itens **intangíveis** (`SYSTEM_ACCESS`: acesso ao ERP,
  e-mail, licenças) que **não são `Asset`** patrimoniais.
- `Asset` é uma **unidade serializada** (tag, nº de série, IMEI) que a solicitação
  não conhece no momento da abertura — só na hora de entregar.

A ligação entre as camadas **já foi prevista** na d2v3cr: `AssetMovement.requestId`
referencia a `Request` do workflow. O exemplo de "Devolução por desligamento" na
`docs/INVENTORY.md` é exatamente o caso de offboarding que o `RequestResource` modela
hoje em alto nível.

## 2. Mapa de sobreposição

```
            INTENÇÃO (base)                        FÍSICO (d2v3cr)
   ┌───────────────────────────┐          ┌──────────────────────────────┐
   │ ResourceItem (catálogo     │ mapeia   │ InventoryItem (catálogo de    │
   │   de tipos requisitáveis)  │ ───────▶ │   modelos físicos)            │
   │  EQUIPMENT/SYSTEM_ACCESS/  │          │  type TI/ADM, category HW/... │
   │  OTHER, por setor          │          └──────────────┬───────────────┘
   └─────────────┬──────────────┘                         │ 1:N
                 │ N:1 (intenção)                          ▼
   ┌─────────────▼──────────────┐   bridge  ┌──────────────────────────────┐
   │ RequestResource            │ ────────▶ │ Asset (unidade física)        │
   │  status PENDING/ALLOCATED/ │  assetId? │  status DISPONIVEL/ATIVO/...  │
   │  RETURNED  (por Request)   │           └──────────────┬───────────────┘
   └────────────────────────────┘                          │ 1:N
                                                            ▼
                                              ┌──────────────────────────────┐
                                              │ AssetMovement (log imutável)  │
                                              │  requestId ──▶ Request        │
                                              └──────────────────────────────┘
```

## 3. Catálogos: manter os dois, com mapeamento opcional

- **Manter `ResourceItem`** como o catálogo de "tipos requisitáveis em fluxos"
  (inclui acessos/serviços intangíveis). É o que a tela de abertura de solicitação
  e o `FlowStep.collectsResources` consomem.
- **Manter `InventoryItem`** como o catálogo patrimonial físico.
- **Mapeamento opcional**: adicionar `ResourceItem.inventoryItemId String?` (nullable).
  Quando preenchido, indica que aquele tipo requisitável corresponde a um modelo
  físico do almoxarifado e, portanto, exige alocação de um `Asset` real. Quando
  nulo (ex.: "Acesso ao ERP"), o cumprimento é puramente lógico (status apenas).

## 4. Ponto de integração (bridge)

Adicionar à camada de intenção um vínculo opcional com a unidade física entregue:

```prisma
model RequestResource {
  // ... campos atuais ...
  assetId String?
  asset   Asset?  @relation(fields: [assetId], references: [id])
}
```

Fluxo de cumprimento:

1. Solicitação de **onboarding** é aberta com `RequestResource` (intenção) em `PENDING`.
2. Na etapa de TI, o responsável **escolhe um `Asset` disponível** para cada
   `RequestResource` físico → grava `assetId` e registra `AssetMovement` `ALOCACAO`
   (`toUserId`/`toDepartmentId`, `requestId`), levando o `Asset` a `ATIVO`.
3. Na conclusão do fluxo, o `RequestResource` vai a `ALLOCATED` (já implementado).
4. No **offboarding**, a conclusão gera `AssetMovement` `DEVOLUCAO` para cada
   `assetId` vinculado (`Asset` → `DISPONIVEL`) e o `RequestResource` vai a `RETURNED`.

## 5. Mapeamento de status / eventos

| `RequestResource.status` | Evento no `Asset` (quando há `assetId`) | `Asset.status` resultante |
|--------------------------|------------------------------------------|---------------------------|
| `PENDING`                | — (ainda não há unidade escolhida)       | `DISPONIVEL`/`RESERVADO`  |
| `ALLOCATED` (onboarding) | `AssetMovement` `ALOCACAO`               | `ATIVO`                   |
| `RETURNED` (offboarding) | `AssetMovement` `DEVOLUCAO`              | `DISPONIVEL`              |

Itens intangíveis (`assetId` nulo) só transicionam o `status` lógico — sem `AssetMovement`.

## 6. Evolução do `advanceRequest` (workflow)

A função `applyResourceTransitions` (já existente em `services/workflow.ts`) passa a,
**dentro da mesma transação atômica**, para cada `RequestResource` com `assetId`:

- onboarding/compra → criar `AssetMovement` `ALOCACAO` e setar `Asset.status = ATIVO`;
- offboarding → criar `AssetMovement` `DEVOLUCAO` e setar `Asset.status = DISPONIVEL`.

Isso mantém a auditoria de inventário (`AssetMovement`, imutável) coerente com a
auditoria do workflow (`AuditLog`) que já é gravada hoje.

## 7. Mecânica de merge (schema, migrations, rotas)

A d2v3cr é **backend-only** (modelos + rotas `/api/inventory` + seed + docs; sem UI),
o que reduz muito o atrito. Passos:

1. **Modelos**: copiar os 6 modelos de inventário para o `schema.prisma` consolidado
   e adicionar as **relações reversas** nos modelos existentes:
   - `User`: `AssetUser`, `MovOrigemUser`, `MovDestinoUser`, `MovCreator`,
     `InventoryCountCreator`;
   - `Department`: relação de `Asset`, `MovOrigemDept`, `MovDestinoDept`,
     `InventoryCount`;
   - `Request`: relação de `AssetMovement` (`requestId`).
2. **Migration**: **não** copiar a migration da d2v3cr (foi gerada de outra base).
   Gerar uma migration **aditiva nova** sobre a consolidação via
   `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --script`,
   contendo apenas os `CREATE TABLE` do inventário.
3. **Rotas**: trazer `src/routes/inventory/*` e o wiring no `index.ts`; revisar o
   ajuste de `middleware/auth.ts` (conferir que não conflita com o RBAC já endurecido).
4. **Seed**: mesclar o seed de inventário (catálogo + alguns `Asset`/`Warehouse`).
5. **Testes/CI**: estender a suíte (vitest) cobrindo o bridge e os tipos de
   `AssetMovement`; o CI já roda `npm test`.

## 8. Decisões em aberto (precisam de você antes do merge)

1. **Unificar catálogos ou mapear?** Recomendação: **mapear** (`ResourceItem.inventoryItemId`),
   preservando os intangíveis. Alternativa: migrar `ResourceItem` físico para
   `InventoryItem` e manter `ResourceItem` só para acessos.
2. **Escolha de `Asset` é manual ou automática?** Recomendação: **manual** na etapa de
   TI (responsável escolhe a unidade), com `RESERVADO` opcional na criação.
3. **Tipo monetário do `Asset.invoiceValue`**: hoje é `Float` na d2v3cr — alinhar com a
   decisão já tomada na base (**centavos `Int`**) ao mergear.
4. **Coordenação**: a sessão da d2v3cr ainda está **ativa**; alinhar antes de
   rebasear/portar para não haver retrabalho.

## 9. Faseamento sugerido

- **Fase 1** ✅ **concluída** — merge aditivo do backend de inventário da d2v3cr na
  consolidação (modelos + rotas `/api/inventory` + seed + migration aditiva
  `20260619140000_add_inventory_assets`), sem bridge. `invoiceValue` migrado para
  `invoiceValueCents` (centavos) e papel `GESTOR` mapeado para `MANAGER`. Inventário
  patrimonial funciona isolado.
- **Fase 2** — bridge `RequestResource.assetId` + evolução do `advanceRequest`
  (alocação/devolução físicas dirigidas pelo workflow).
- **Fase 3** — UI de inventário (catálogo, ativos, movimentações, contagem) e a
  seleção de `Asset` na etapa de TI do onboarding.
