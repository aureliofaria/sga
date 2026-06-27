import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/lib/prisma';
import { buildRequestWhere, canViewRequest, resolveVisibilityScope } from '../src/lib/visibility';
import { makeFlow, makeUser, resetDb } from './factory';

// Cria um pedido mínimo para o iniciador informado.
async function makeRequest(flowId: string, initiatorId: string, title = 'pedido') {
  return prisma.request.create({
    data: { flowId, initiatorId, title, status: 'IN_PROGRESS', currentStep: 0 },
  });
}

// Cria uma tarefa atribuída ao usuário no pedido (responsável atual).
async function assignTask(requestId: string, flowId: string, assigneeId: string) {
  const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flowId } });
  return prisma.requestTask.create({
    data: { requestId, stepId: step.id, assigneeId, title: 't', status: 'PENDING' },
  });
}

// Lista os pedidos visíveis ao usuário aplicando o where da listagem.
async function listVisible(user: { id: string; role?: string | null }) {
  const where = await buildRequestWhere(user);
  return prisma.request.findMany({ where, select: { id: true } });
}

describe('visibilidade por setor/hierarquia (Fase 0 · Passo 3)', () => {
  beforeEach(resetDb);

  it('Membro vê apenas os próprios pedidos', async () => {
    const sector = await prisma.sector.create({ data: { name: 'Setor M' } });
    const membro = await makeUser('USER', 'membro');
    const outro = await makeUser('USER', 'outro');
    await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: membro.id, role: 'PROTETOR', level: 'MEMBRO' } });

    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const meu = await makeRequest(flow.id, membro.id, 'meu');
    await makeRequest(flow.id, outro.id, 'do outro');

    const visible = await listVisible(membro);
    expect(visible.map((r) => r.id)).toEqual([meu.id]);
  });

  it('usuário sem filiação vê apenas os próprios pedidos', async () => {
    const semSetor = await makeUser('USER', 'avulso');
    const outro = await makeUser('USER', 'outro2');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const meu = await makeRequest(flow.id, semSetor.id, 'meu');
    await makeRequest(flow.id, outro.id, 'alheio');

    const visible = await listVisible(semSetor);
    expect(visible.map((r) => r.id)).toEqual([meu.id]);
  });

  it('Líder II vê os próprios e os dos seus Membros diretos, mas não os de outros', async () => {
    const sector = await prisma.sector.create({ data: { name: 'Setor L2' } });
    const l1u = await makeUser('USER', 'l1');
    const l2u = await makeUser('USER', 'l2');
    const memUser = await makeUser('USER', 'mem');
    const foraUser = await makeUser('USER', 'fora'); // membro do setor, mas reporta a outro

    const l1 = await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: l1u.id, role: 'LIDER', level: 'LIDER_1' } });
    const l2 = await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: l2u.id, role: 'LIDER', level: 'LIDER_2', reportsToId: l1.id } });
    await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: memUser.id, role: 'PROTETOR', level: 'MEMBRO', reportsToId: l2.id } });
    await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: foraUser.id, role: 'PROTETOR', level: 'MEMBRO', reportsToId: l1.id } });

    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const proprio = await makeRequest(flow.id, l2u.id, 'proprio');
    const doMembro = await makeRequest(flow.id, memUser.id, 'do membro');
    const doFora = await makeRequest(flow.id, foraUser.id, 'do fora');

    const visible = await listVisible(l2u);
    const ids = visible.map((r) => r.id).sort();
    expect(ids).toEqual([proprio.id, doMembro.id].sort());
    expect(ids).not.toContain(doFora.id);
  });

  it('Líder I vê TODOS os pedidos do setor (iniciados por qualquer membro)', async () => {
    const sector = await prisma.sector.create({ data: { name: 'Setor L1' } });
    const outroSetor = await prisma.sector.create({ data: { name: 'Outro Setor' } });
    const l1u = await makeUser('USER', 'lider1');
    const l2u = await makeUser('USER', 'lider2');
    const memUser = await makeUser('USER', 'membro');
    const externo = await makeUser('USER', 'externo');

    const l1 = await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: l1u.id, role: 'LIDER', level: 'LIDER_1' } });
    const l2 = await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: l2u.id, role: 'LIDER', level: 'LIDER_2', reportsToId: l1.id } });
    await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: memUser.id, role: 'PROTETOR', level: 'MEMBRO', reportsToId: l2.id } });
    await prisma.sectorMember.create({ data: { sectorId: outroSetor.id, userId: externo.id, role: 'PROTETOR', level: 'MEMBRO' } });

    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const r1 = await makeRequest(flow.id, l2u.id, 'do l2');
    const r2 = await makeRequest(flow.id, memUser.id, 'do membro');
    const externa = await makeRequest(flow.id, externo.id, 'externa');

    const visible = await listVisible(l1u);
    const ids = visible.map((r) => r.id);
    expect(ids).toContain(r1.id);
    expect(ids).toContain(r2.id);
    expect(ids).not.toContain(externa.id);
  });

  it('Líder I vê pedido com tarefa atribuída a alguém do setor mesmo iniciado fora', async () => {
    const sector = await prisma.sector.create({ data: { name: 'Setor Tarefa' } });
    const l1u = await makeUser('USER', 'lider1');
    const memUser = await makeUser('USER', 'membro');
    const externo = await makeUser('USER', 'externo');
    await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: l1u.id, role: 'LIDER', level: 'LIDER_1' } });
    await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: memUser.id, role: 'PROTETOR', level: 'MEMBRO' } });

    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    // Pedido iniciado por externo, mas com tarefa atribuída a um membro do setor.
    const externa = await makeRequest(flow.id, externo.id, 'externa com tarefa interna');
    await assignTask(externa.id, flow.id, memUser.id);

    const visible = await listVisible(l1u);
    expect(visible.map((r) => r.id)).toContain(externa.id);
  });

  it('Diretoria e ADMIN têm visão global', async () => {
    const dir = await makeUser('DIRETORIA', 'diretor');
    const adminU = await makeUser('ADMIN', 'admin');
    const qualquer = await makeUser('USER', 'qualquer');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const r = await makeRequest(flow.id, qualquer.id, 'pedido alheio');

    expect(await buildRequestWhere(dir)).toEqual({});
    expect(await buildRequestWhere(adminU)).toEqual({});
    expect((await resolveVisibilityScope(dir)).globalView).toBe(true);

    const visibleDir = await listVisible(dir);
    expect(visibleDir.map((x) => x.id)).toContain(r.id);
  });

  it('canViewRequest fecha o IDOR: fora do escopo 403, próprio 200, Líder I do setor 200', async () => {
    const sector = await prisma.sector.create({ data: { name: 'Setor IDOR' } });
    const l1u = await makeUser('USER', 'lider1');
    const memUser = await makeUser('USER', 'membro');
    const forasteiro = await makeUser('USER', 'forasteiro');
    await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: l1u.id, role: 'LIDER', level: 'LIDER_1' } });
    await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: memUser.id, role: 'PROTETOR', level: 'MEMBRO' } });

    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const pedido = await makeRequest(flow.id, memUser.id, 'do membro');
    const view = { initiatorId: pedido.initiatorId, tasks: [] as { assigneeId: string | null }[] };

    expect(await canViewRequest(forasteiro, view)).toBe(false); // fora do escopo
    expect(await canViewRequest(memUser, view)).toBe(true); // próprio iniciador
    expect(await canViewRequest(l1u, view)).toBe(true); // Líder I do setor
  });

  it('Suplência: Líder II com delegação vigente ganha escopo de Líder I do setor', async () => {
    const sector = await prisma.sector.create({ data: { name: 'Setor Suplência' } });
    const l1u = await makeUser('USER', 'lider1');
    const l2u = await makeUser('USER', 'lider2');
    const memUser = await makeUser('USER', 'membro');

    const l1 = await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: l1u.id, role: 'LIDER', level: 'LIDER_1' } });
    const l2 = await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: l2u.id, role: 'LIDER', level: 'LIDER_2', reportsToId: l1.id } });
    // Membro reporta direto ao Líder I (fora do escopo padrão do Líder II).
    await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: memUser.id, role: 'PROTETOR', level: 'MEMBRO', reportsToId: l1.id } });

    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const doMembro = await makeRequest(flow.id, memUser.id, 'do membro');

    // Sem delegação: Líder II NÃO vê o pedido do membro (que reporta ao Líder I).
    expect((await listVisible(l2u)).map((r) => r.id)).not.toContain(doMembro.id);

    // Líder I delega ao Líder II com prazo no futuro.
    await prisma.sectorMember.update({
      where: { id: l1.id },
      data: { delegateToId: l2.id, delegateUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });

    // Com delegação vigente: Líder II passa a enxergar todo o setor (escopo de L1).
    expect((await listVisible(l2u)).map((r) => r.id)).toContain(doMembro.id);

    // Delegação expirada não concede escopo.
    await prisma.sectorMember.update({
      where: { id: l1.id },
      data: { delegateUntil: new Date(Date.now() - 1000) },
    });
    expect((await listVisible(l2u)).map((r) => r.id)).not.toContain(doMembro.id);
  });
});
