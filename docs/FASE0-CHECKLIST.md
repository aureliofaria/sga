# Fase 0 — Organização & Acessos · Checklist de construção

Ordem de implementação (cada item = um passo verificável, com build+testes verdes antes de seguir). Base: `claude/deploy-v1-2g02g7` (já com a correção anti-IDOR `21d7579`). Detalhe completo em `docs/SPEC-FASE-0-1.md`.

## Sequência

- [x] **1. Papéis & Setores (sem migration)** — constantes canônicas dos papéis (TI, DADOS, SISTEMAS, ADMINISTRATIVO, DIRETORIA + ADMIN/HR/FINANCE/MANAGER/USER) e dos 20 setores; validação no cadastro de usuário/setor. *(User.role já é string — não exige migration.)*
- [x] **2. Hierarquia de setor (migration)** — `SectorMember.level` ∈ {LIDER_1, LIDER_2, MEMBRO}, `reportsToMemberId`, `delegateToMemberId` + `delegateUntil`. Invariante: **exatamente 1 LIDER_1 por setor** (constraint + validação na API + guarda na tela).
- [x] **3. Visibilidade por setor/hierarquia** — `buildVisibilityScope`: Membro só os próprios; Líder II próprios + dos seus Membros; Líder I tudo do setor; Diretoria/ADMIN tudo. Substitui o filtro de papel coarse e **remove o broadcast do papel genérico USER** (fecha por completo o resíduo de IDOR).
- [x] **4. Mascaramento de campos sensíveis** — motor de mascaramento (LGPD) + política de acesso por papel/função (CPF/RG/salário só RH+Diretoria+ADMIN; TI/SISTEMAS/DADOS/ADM recebem mascarado) + auditoria de acesso (`AuditLog` `SENSITIVE_VIEW`). Plugado em `GET /requests/:id`; *no-op* verificável até o Passo 7 alimentar os campos dinâmicos com a flag de sensibilidade. Sem migration. `lib/fieldMasking.ts`, 17 testes.
- [ ] **5. Ações de aprovação ricas** — deferir / indeferir / solicitar correção / solicitar informação complementar / encaminhar; devolução ao solicitante com reenvio.
- [ ] **6. Filas de função** — tarefa de função vai à fila (qualquer Membro da função assume; fallback Líder II → Líder I se não houver Membro). Fila de Diretoria (qualquer diretor).
- [ ] **7. Campos dinâmicos por etapa** — FormSchema/FormField configuráveis por etapa/fluxo, com flag de sensibilidade (alimenta o mascaramento).
- [ ] **8. Subtarefas/checklist** — itens por tarefa com "conclui só quando todas validadas"; subtarefas condicionais (telefone/VOIP/celular/PowerBI).
- [ ] **9. Subfluxo pai↔filho** — `Request.parentRequestId`; abrir compra vinculada na mesma aba e retornar ao ponto com o protocolo preenchido.
- [ ] **10. Status customizados** — "Seleção em andamento", "Preparar onboarding" etc.
- [ ] **11. Escalonamento temporal** — agendador in-process (2º/3º/7º dia) + justificativa de atraso vinculada às notificações.
- [ ] **12. Parâmetros Financeiros** — tetos de alçada + previsão orçamentária mensal por setor/centro de custo/classe (editável por Diretoria/Líder Financeiro/ADMIN). Liga o roteamento de compra/pagamento.
- [ ] **13. Delegação/suplência do Líder I** — delegar a um Líder II por período (ausência), para o setor não travar.

## Regras transversais
- Build (`tsc`) + `npm test -w backend` + smoke E2E **verdes** a cada passo, com reseed limpo do `dev.db` antes do E2E.
- Sempre regenerar o Prisma Client a partir do schema desta branch (evita contaminação por outras branches no `node_modules` compartilhado).
- Prod-safe; nada de credenciais de demonstração em produção.

## Conexão
- Fase 1 (trilha 1→11) e Prioridade 2 (compra/pagamento — PR #9 do Pagador) plugam nesta fundação. O item **3** desta lista é o que fecha por completo o resíduo de IDOR de leitura do app atual.
