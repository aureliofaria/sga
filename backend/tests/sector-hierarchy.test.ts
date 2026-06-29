import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/lib/prisma';
import { makeUser, resetDb } from './factory';

describe('hierarquia de setor (Fase 0)', () => {
  beforeEach(resetDb);

  it('impede 2 Líder I no mesmo setor (índice único parcial)', async () => {
    const s = await prisma.sector.create({ data: { name: 'Setor X' } });
    const u1 = await makeUser('USER', 'lider1');
    const u2 = await makeUser('USER', 'outro');
    await prisma.sectorMember.create({ data: { sectorId: s.id, userId: u1.id, role: 'LIDER', level: 'LIDER_1' } });
    await expect(
      prisma.sectorMember.create({ data: { sectorId: s.id, userId: u2.id, role: 'LIDER', level: 'LIDER_1' } }),
    ).rejects.toThrow();
  });

  it('permite o mesmo Líder I em setores diferentes', async () => {
    const s1 = await prisma.sector.create({ data: { name: 'Setor A' } });
    const s2 = await prisma.sector.create({ data: { name: 'Setor B' } });
    const u = await makeUser('USER', 'compartilhado');
    await prisma.sectorMember.create({ data: { sectorId: s1.id, userId: u.id, role: 'LIDER', level: 'LIDER_1' } });
    const m2 = await prisma.sectorMember.create({ data: { sectorId: s2.id, userId: u.id, role: 'LIDER', level: 'LIDER_1' } });
    expect(m2.level).toBe('LIDER_1');
  });

  it('permite múltiplos Líder II e Membros, com vínculo de reporte', async () => {
    const s = await prisma.sector.create({ data: { name: 'Setor Y' } });
    const l1 = await makeUser('USER', 'l1');
    const l2a = await makeUser('USER', 'l2a');
    const l2b = await makeUser('USER', 'l2b');
    const mem = await makeUser('USER', 'mem');
    const lider1 = await prisma.sectorMember.create({ data: { sectorId: s.id, userId: l1.id, role: 'LIDER', level: 'LIDER_1' } });
    const lider2a = await prisma.sectorMember.create({ data: { sectorId: s.id, userId: l2a.id, role: 'LIDER', level: 'LIDER_2', reportsToId: lider1.id } });
    await prisma.sectorMember.create({ data: { sectorId: s.id, userId: l2b.id, role: 'LIDER', level: 'LIDER_2', reportsToId: lider1.id } });
    const membro = await prisma.sectorMember.create({ data: { sectorId: s.id, userId: mem.id, role: 'PROTETOR', level: 'MEMBRO', reportsToId: lider2a.id } });
    const l2count = await prisma.sectorMember.count({ where: { sectorId: s.id, level: 'LIDER_2' } });
    expect(l2count).toBe(2);
    expect(membro.reportsToId).toBe(lider2a.id);
  });
});
