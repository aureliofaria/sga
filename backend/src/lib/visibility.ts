// ============================================================================
// Visibilidade por SETOR / HIERARQUIA (Fase 0 · Passo 3)
//
// Substitui o filtro grosso por papel (ADMIN/MANAGER/FINANCE/HR veem tudo;
// senão só o iniciador) por um ESCOPO de setor/hierarquia, fechando o IDOR de
// leitura sem quebrar a segregação de funções.
//
// Modelo (UNIÃO de todas as filiações do espectador via SectorMember):
//  • ADMIN e DIRETORIA: tudo.
//  • Líder I (level LIDER_1) de um setor: TODOS os pedidos do setor — iniciados
//    por qualquer membro do setor OU com tarefa atribuída a alguém do setor.
//  • Líder II (level LIDER_2): próprios + pedidos iniciados por (ou com tarefa
//    atribuída a) ele ou seus Membros diretos (SectorMember.reportsToId = a
//    linha de filiação do Líder II).
//  • Membro (level MEMBRO) ou sem filiação: só os pedidos que ele iniciou.
//  • Suplência: um Líder II com delegação VIGENTE (a linha do Líder I aponta
//    delegateToId -> a linha do Líder II e delegateUntil no futuro) ganha o
//    escopo de Líder I daquele setor.
//
// A função de visibilidade resolve, para o espectador, o CONJUNTO de userIds
// cujos pedidos (como iniciador ou como responsável de tarefa) ele pode ver.
// Esse conjunto vira um filtro Prisma e o predicado de detalhe.
// ============================================================================

import prisma from './prisma';

type Db = typeof prisma;

export interface Viewer {
  id: string;
  role?: string | null;
}

// DIRETORIA é papel global de negócio (vê tudo); ADMIN administra a aplicação.
const GLOBAL_VIEW_ROLES = new Set(['ADMIN', 'DIRETORIA']);

export function hasGlobalView(user: Viewer): boolean {
  return GLOBAL_VIEW_ROLES.has((user.role ?? '') as string);
}

// Linha de filiação relevante para o cálculo de escopo.
interface MemberRow {
  id: string;
  sectorId: string;
  userId: string;
  level: string;
  reportsToId: string | null;
}

// Resolve o ESCOPO de visibilidade do espectador: o conjunto de userIds cujos
// pedidos ele pode enxergar (sempre inclui o próprio). `globalView` indica que
// ele vê tudo (ADMIN/DIRETORIA) e o conjunto de ids deve ser ignorado.
export interface VisibilityScope {
  globalView: boolean;
  // userIds cujos pedidos (iniciador OU responsável por tarefa) o espectador vê.
  visibleUserIds: Set<string>;
}

export async function resolveVisibilityScope(user: Viewer, db: Db = prisma): Promise<VisibilityScope> {
  const visibleUserIds = new Set<string>([user.id]);
  if (hasGlobalView(user)) {
    return { globalView: true, visibleUserIds };
  }

  // Filiações do espectador (as posições que ele ocupa nos setores).
  const myMemberships = (await db.sectorMember.findMany({
    where: { userId: user.id },
    select: { id: true, sectorId: true, userId: true, level: true, reportsToId: true, delegateUntil: true },
  })) as Array<MemberRow & { delegateUntil: Date | null }>;

  if (myMemberships.length === 0) {
    // Sem filiação: comporta-se como Membro — só os próprios pedidos.
    return { globalView: false, visibleUserIds };
  }

  // Setores onde o espectador atua como Líder I (escopo do setor inteiro).
  const sectorWideIds = new Set<string>();
  // Linhas de filiação (do espectador) cujos Membros diretos ele pode ver (Líder II).
  const lider2MembershipIds = new Set<string>();

  for (const m of myMemberships) {
    if (m.level === 'LIDER_1') {
      sectorWideIds.add(m.sectorId);
    } else if (m.level === 'LIDER_2') {
      lider2MembershipIds.add(m.id);
    }
    // MEMBRO não amplia o escopo além do próprio (já incluído).
  }

  // Suplência: se a linha do Líder I de um setor delega a uma filiação do
  // espectador com delegateUntil no futuro, o espectador ganha escopo de Líder I
  // daquele setor enquanto a delegação vigorar.
  const now = new Date();
  const myMembershipIds = myMemberships.map((m) => m.id);
  if (myMembershipIds.length > 0) {
    const activeDelegations = await db.sectorMember.findMany({
      where: {
        delegateToId: { in: myMembershipIds },
        delegateUntil: { gt: now },
      },
      select: { sectorId: true },
    });
    for (const d of activeDelegations) sectorWideIds.add(d.sectorId);
  }

  // Líder I: todos os usuários filiados aos setores de escopo amplo.
  if (sectorWideIds.size > 0) {
    const sectorMembers = await db.sectorMember.findMany({
      where: { sectorId: { in: Array.from(sectorWideIds) } },
      select: { userId: true },
    });
    for (const sm of sectorMembers) visibleUserIds.add(sm.userId);
  }

  // Líder II: os Membros diretos (reportsToId aponta para a filiação do líder).
  if (lider2MembershipIds.size > 0) {
    const reports = await db.sectorMember.findMany({
      where: { reportsToId: { in: Array.from(lider2MembershipIds) } },
      select: { userId: true },
    });
    for (const r of reports) visibleUserIds.add(r.userId);
  }

  return { globalView: false, visibleUserIds };
}

// Filtro Prisma `where` para a listagem GET /api/requests, conforme o escopo.
// Mantém os demais filtros (status/type/search) compostos pelo chamador.
export async function buildRequestWhere(user: Viewer, db: Db = prisma): Promise<any> {
  const scope = await resolveVisibilityScope(user, db);
  if (scope.globalView) return {};

  const ids = Array.from(scope.visibleUserIds);
  // Pedido visível se foi iniciado por alguém do escopo OU tem tarefa atribuída
  // a alguém do escopo (responsável atual em execução).
  return {
    OR: [
      { initiatorId: { in: ids } },
      { tasks: { some: { assigneeId: { in: ids } } } },
    ],
  };
}

// Forma mínima necessária para decidir o acesso a um pedido específico.
// `approvals` é opcional: quem registrou uma decisão na solicitação (aprovador)
// mantém acesso ao detalhe ainda que não esteja no escopo de setor — preserva a
// garantia legítima de leitura que o filtro grosso anterior dava ao aprovador.
export interface RequestForView {
  initiatorId: string;
  tasks: { assigneeId: string | null }[];
  approvals?: { approverId: string }[];
}

// Predicado de acesso ao detalhe/anexos/auditoria/comentários de um pedido.
// Reaproveita o escopo (mesma semântica da listagem). Espera um pedido com
// `initiatorId`, `tasks[].assigneeId` e (opcionalmente) `approvals[].approverId`.
export async function canViewRequest(user: Viewer, request: RequestForView, db: Db = prisma): Promise<boolean> {
  // O próprio aprovador sempre enxerga o que decidiu (independe de escopo).
  if (request.approvals?.some((a) => a.approverId === user.id)) return true;
  const scope = await resolveVisibilityScope(user, db);
  if (scope.globalView) return true;
  if (scope.visibleUserIds.has(request.initiatorId)) return true;
  return request.tasks.some((t) => t.assigneeId != null && scope.visibleUserIds.has(t.assigneeId));
}
