import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { SECTOR_LEVELS } from '../lib/org';

const router = Router();

// Mapeia o nível hierárquico (Fase 0) para o papel legado (LIDER/PROTETOR),
// mantido por compatibilidade (escalonamento de SLA, frontend atual).
const levelToRole = (level: string) => (level === 'MEMBRO' ? 'PROTETOR' : 'LIDER');
const roleToLevel = (role: string) => (role === 'LIDER' ? 'LIDER_1' : 'MEMBRO');

// Resolve o nível a partir de { level } (preferido) ou { role } (legado).
// Retorna null se inválido.
function resolveLevel(rawLevel?: string, role?: string): string | null {
  if (rawLevel) return (SECTOR_LEVELS as readonly string[]).includes(rawLevel) ? rawLevel : null;
  if (role) return ['LIDER', 'PROTETOR'].includes(role) ? roleToLevel(role) : null;
  return null;
}

// Lista setores — ADMIN vê todos; demais veem apenas onde são membros
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const isAdmin = req.user?.role === 'ADMIN';
    const where = isAdmin
      ? {}
      : { members: { some: { userId: req.user!.id } } };

    const sectors = await prisma.sector.findMany({
      where,
      include: {
        _count: { select: { members: true, users: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
          orderBy: { role: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
    res.json(sectors);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar setores' });
  }
});

// Detalhe de um setor — valida acesso do usuário
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const isAdmin = req.user?.role === 'ADMIN';
    if (!isAdmin) {
      const membership = await prisma.sectorMember.findFirst({
        where: { sectorId: req.params.id, userId: req.user!.id },
      });
      if (!membership) { res.status(403).json({ error: 'Acesso negado a este setor' }); return; }
    }

    const sector = await prisma.sector.findUnique({
      where: { id: req.params.id },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        },
        users: { select: { id: true, name: true, email: true, role: true, isActive: true } },
        flowTemplates: { select: { id: true, name: true, type: true, scope: true, isActive: true } },
        _count: { select: { members: true, users: true, flowTemplates: true } },
      },
    });
    if (!sector) { res.status(404).json({ error: 'Setor não encontrado' }); return; }
    res.json(sector);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar setor' });
  }
});

// Criar setor
router.post('/', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'Nome é obrigatório' }); return; }
    const sector = await prisma.sector.create({ data: { name: name.trim(), description } });
    res.status(201).json(sector);
  } catch {
    res.status(500).json({ error: 'Erro ao criar setor' });
  }
});

// Atualizar setor
router.put('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, isActive } = req.body;
    const sector = await prisma.sector.update({
      where: { id: req.params.id },
      data: { name, description, isActive },
    });
    res.json(sector);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar setor' });
  }
});

// Excluir setor
router.delete('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.sector.delete({ where: { id: req.params.id } });
    res.json({ message: 'Setor removido com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover setor' });
  }
});

// Adicionar/atualizar membro. Aceita { level } (LIDER_1|LIDER_2|MEMBRO) — ou o
// { role } legado (LIDER|PROTETOR) — e, opcionalmente, reportsToId (a quem o
// Membro reporta: um LIDER_2 ou o LIDER_1). Invariante: 1 LIDER_1 por setor.
router.post('/:id/members', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, role, level: rawLevel, reportsToId } = req.body;
    if (!userId) { res.status(400).json({ error: 'userId é obrigatório' }); return; }
    const level = resolveLevel(rawLevel, role);
    if (!level) { res.status(400).json({ error: 'Informe level (LIDER_1|LIDER_2|MEMBRO) ou role (LIDER|PROTETOR) válido' }); return; }

    // Invariante: no máximo 1 LIDER_1 por setor.
    if (level === 'LIDER_1') {
      const other = await prisma.sectorMember.findFirst({ where: { sectorId: req.params.id, level: 'LIDER_1', userId: { not: userId } } });
      if (other) { res.status(409).json({ error: 'Este setor já possui um Líder I' }); return; }
    }

    const include = { user: { select: { id: true, name: true, email: true, role: true } } };
    const data = { role: levelToRole(level), level, reportsToId: reportsToId ?? null };
    const existing = await prisma.sectorMember.findFirst({ where: { sectorId: req.params.id, userId } });
    const member = existing
      ? await prisma.sectorMember.update({ where: { id: existing.id }, data, include })
      : await prisma.sectorMember.create({ data: { sectorId: req.params.id, userId, ...data }, include });
    res.status(201).json(member);
  } catch {
    res.status(500).json({ error: 'Erro ao adicionar membro' });
  }
});

// Remover membro
router.delete('/:id/members/:memberId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.sectorMember.delete({ where: { id: req.params.memberId } });
    res.json({ message: 'Membro removido com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover membro' });
  }
});

// Alterar papel do membro
router.put('/:id/members/:memberId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { role, level: rawLevel, reportsToId } = req.body;
    const current = await prisma.sectorMember.findUnique({ where: { id: req.params.memberId } });
    if (!current) { res.status(404).json({ error: 'Membro não encontrado' }); return; }
    const level = resolveLevel(rawLevel, role) ?? current.level;
    if (rawLevel || role) {
      if (!resolveLevel(rawLevel, role)) { res.status(400).json({ error: 'level/role inválido' }); return; }
    }
    // Invariante: 1 LIDER_1 por setor.
    if (level === 'LIDER_1') {
      const other = await prisma.sectorMember.findFirst({ where: { sectorId: current.sectorId, level: 'LIDER_1', id: { not: current.id } } });
      if (other) { res.status(409).json({ error: 'Este setor já possui um Líder I' }); return; }
    }
    const data: any = { level, role: levelToRole(level) };
    if (reportsToId !== undefined) data.reportsToId = reportsToId;
    const member = await prisma.sectorMember.update({
      where: { id: req.params.memberId },
      data,
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
    res.json(member);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar papel do membro' });
  }
});

// ---------------------------------------------------------------------------
// Suplência / delegação do Líder I (Fase 0 · Passo 13)
//
// A delegação vive na LINHA do Líder I do setor: delegateToId aponta para a
// linha (SectorMember) do Líder II suplente e delegateUntil é o fim do período.
// A visibilidade por suplência (lib/visibility.ts) e o gate financeiro
// (lib/financeParams.ts) consomem esses campos enquanto delegateUntil > agora.
//
// Auditoria: como transfere AUTORIDADE (financeira, etc.), a concessão/revogação
// é registrada de forma PERSISTENTE e consultável em DelegationAuditLog
// (DELEGATION_SET / DELEGATION_CLEARED) com quem delegou, suplente e prazo. O
// AuditLog principal exige requestId (FK), por isso a tabela dedicada (mesmo
// padrão do FinanceParamAuditLog). A resposta devolve o estado da delegação.
//
// FOLLOW-UP (extensão futura, NÃO implementado aqui): a suplência ainda não
// redireciona o ESCALONAMENTO temporal (Passo 11 escala ao titular LIDER_1) nem
// o FALLBACK de fila (Passo 6). Esses pontos continuam mirando o titular.
// ---------------------------------------------------------------------------

// Autoriza o chamador a gerir a delegação do setor: ADMIN OU o Líder I (LIDER_1)
// do próprio setor. Retorna a linha do Líder I do setor (ou null se não há).
async function resolveDelegationAuth(
  req: AuthRequest,
  sectorId: string
): Promise<{ authorized: boolean; lider1: { id: string; userId: string } | null }> {
  const lider1 = await prisma.sectorMember.findFirst({
    where: { sectorId, level: 'LIDER_1' },
    select: { id: true, userId: true },
  });
  const isAdmin = req.user?.role === 'ADMIN';
  const isLider1 = lider1 != null && lider1.userId === req.user!.id;
  return { authorized: isAdmin || isLider1, lider1 };
}

// PUT /:sectorId/delegation — define a suplência. Body { delegateUserId, until }.
router.put('/:sectorId/delegation', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { sectorId } = req.params;
    const { authorized, lider1 } = await resolveDelegationAuth(req, sectorId);
    if (!authorized) { res.status(403).json({ error: 'Apenas o Líder I do setor ou um ADMIN podem gerir a suplência' }); return; }
    if (!lider1) { res.status(400).json({ error: 'O setor não possui um Líder I para delegar' }); return; }

    const { delegateUserId, until } = req.body ?? {};
    if (!delegateUserId) { res.status(400).json({ error: 'delegateUserId é obrigatório' }); return; }
    if (delegateUserId === lider1.userId) { res.status(400).json({ error: 'O suplente deve ser um Líder II do mesmo setor' }); return; }

    // until deve ser data futura válida.
    const untilDate = until ? new Date(until) : null;
    if (!untilDate || Number.isNaN(untilDate.getTime()) || untilDate.getTime() <= Date.now()) {
      res.status(400).json({ error: 'until deve ser uma data futura válida' }); return;
    }

    // O suplente deve ser um Líder II do MESMO setor.
    const suplente = await prisma.sectorMember.findFirst({
      where: { sectorId, userId: delegateUserId, level: 'LIDER_2' },
      select: { id: true },
    });
    if (!suplente) { res.status(400).json({ error: 'O suplente deve ser um Líder II do mesmo setor' }); return; }

    const updated = await prisma.sectorMember.update({
      where: { id: lider1.id },
      data: { delegateToId: suplente.id, delegateUntil: untilDate },
      select: { id: true, sectorId: true, delegateToId: true, delegateUntil: true },
    });

    // Trilha PERSISTENTE da concessão (autoridade transferida → auditável).
    await prisma.delegationAuditLog.create({
      data: {
        sectorId, lider1MemberId: lider1.id, delegateMemberId: suplente.id,
        delegateUserId, action: 'DELEGATION_SET', until: untilDate,
        byUserId: req.user!.id, byUserName: req.user!.name,
      },
    });

    res.json({ sectorId: updated.sectorId, delegateToId: updated.delegateToId, delegateUntil: updated.delegateUntil });
  } catch {
    res.status(500).json({ error: 'Erro ao definir suplência' });
  }
});

// DELETE /:sectorId/delegation — limpa a suplência na linha do Líder I.
router.delete('/:sectorId/delegation', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { sectorId } = req.params;
    const { authorized, lider1 } = await resolveDelegationAuth(req, sectorId);
    if (!authorized) { res.status(403).json({ error: 'Apenas o Líder I do setor ou um ADMIN podem gerir a suplência' }); return; }
    if (!lider1) { res.status(400).json({ error: 'O setor não possui um Líder I' }); return; }

    const updated = await prisma.sectorMember.update({
      where: { id: lider1.id },
      data: { delegateToId: null, delegateUntil: null },
      select: { sectorId: true, delegateToId: true, delegateUntil: true },
    });

    await prisma.delegationAuditLog.create({
      data: {
        sectorId, lider1MemberId: lider1.id, action: 'DELEGATION_CLEARED',
        byUserId: req.user!.id, byUserName: req.user!.name,
      },
    });

    res.json({ sectorId: updated.sectorId, delegateToId: updated.delegateToId, delegateUntil: updated.delegateUntil });
  } catch {
    res.status(500).json({ error: 'Erro ao remover suplência' });
  }
});

// Usuários disponíveis para adicionar ao setor
router.get('/:id/available-users', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.sectorMember.findMany({
      where: { sectorId: req.params.id },
      select: { userId: true },
    });
    const existingIds = existing.map((m) => m.userId);
    const users = await prisma.user.findMany({
      where: { isActive: true, id: { notIn: existingIds } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar usuários disponíveis' });
  }
});

export default router;
