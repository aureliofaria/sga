import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/lib/prisma';
import {
  SensitiveType,
  maskValue,
  maskFields,
  resolveViewerSensitiveAccess,
  recordSensitiveAccess,
} from '../src/lib/fieldMasking';
import { applyMaskWithRegistry, maskRequestForViewer } from '../src/routes/requests';
import { makeFlow, makeUser, resetDb } from './factory';

// Extrai os dígitos de um valor (para afirmar que NENHUM vaza na máscara).
function digits(v: string | number): string {
  return String(v).replace(/\D/g, '');
}

describe('mascaramento de campos sensíveis (Fase 0 · Passo 4)', () => {
  beforeEach(resetDb);

  describe('maskValue', () => {
    it('mascara cada tipo no formato esperado', () => {
      expect(maskValue('CPF', '123.456.789-09')).toBe('***.***.***-**');
      expect(maskValue('RG', '12.345.678-9')).toBe('**.***.***-*');
      expect(maskValue('SALARY', 750000)).toBe('R$ ••••••');
      expect(maskValue('EMAIL_PERSONAL', 'pessoa@gmail.com')).toBe('•••••@•••••');
      expect(maskValue('PHONE_PERSONAL', '(11) 98888-7777')).toBe('(••) •••••-••••');
    });

    it('nulo/indefinido/vazio vira string vazia', () => {
      expect(maskValue('CPF', null)).toBe('');
      expect(maskValue('CPF', undefined)).toBe('');
      expect(maskValue('CPF', '')).toBe('');
      expect(maskValue('CPF', '   ')).toBe('');
    });

    it('nunca vaza nenhum dígito do valor original', () => {
      const samples: Array<[SensitiveType, string | number]> = [
        ['CPF', '123.456.789-09'],
        ['RG', '12.345.678-9'],
        ['SALARY', 987654],
        ['PHONE_PERSONAL', '(11) 91234-5678'],
      ];
      for (const [type, value] of samples) {
        const masked = maskValue(type, value);
        for (const d of digits(value)) {
          expect(masked).not.toContain(d);
        }
      }
    });

    it('tipo desconhecido (defensivo) cai em máscara genérica fail-safe, nunca no valor cru', () => {
      // Fora do contrato TS: simula um tipo dinâmico (Passo 7) não previsto.
      const out = maskValue('NAO_EXISTE' as SensitiveType, '123.456.789-09');
      expect(out).toBe('••••••');
      expect(out).not.toContain('1'); // não vaza dígito
      expect(out).not.toBe(undefined); // nunca apaga/retorna undefined
    });
  });

  describe('resolveViewerSensitiveAccess', () => {
    it('ADMIN libera todos os tipos', async () => {
      const u = await makeUser('ADMIN', 'admin');
      const allowed = await resolveViewerSensitiveAccess(u);
      expect([...allowed].sort()).toEqual(['CPF', 'EMAIL_PERSONAL', 'PHONE_PERSONAL', 'RG', 'SALARY']);
    });

    it('DIRETORIA libera todos os tipos', async () => {
      const u = await makeUser('DIRETORIA', 'diretor');
      const allowed = await resolveViewerSensitiveAccess(u);
      expect([...allowed].sort()).toEqual(['CPF', 'EMAIL_PERSONAL', 'PHONE_PERSONAL', 'RG', 'SALARY']);
    });

    it("role legado 'HR' libera CPF/RG/SALARY", async () => {
      const u = await makeUser('HR', 'rh-legado');
      const allowed = await resolveViewerSensitiveAccess(u);
      expect(allowed.has('CPF')).toBe(true);
      expect(allowed.has('RG')).toBe(true);
      expect(allowed.has('SALARY')).toBe(true);
    });

    it("membro do setor 'RH' libera CPF/RG/SALARY", async () => {
      const sector = await prisma.sector.create({ data: { name: 'RH' } });
      const u = await makeUser('USER', 'pessoa-rh');
      await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: u.id, role: 'PROTETOR', level: 'MEMBRO' } });
      const allowed = await resolveViewerSensitiveAccess(u);
      expect(allowed.has('CPF')).toBe(true);
      expect(allowed.has('RG')).toBe(true);
      expect(allowed.has('SALARY')).toBe(true);
    });

    it("membro de 'TI, Dados e Infra' NÃO libera CPF/RG/SALARY", async () => {
      const sector = await prisma.sector.create({ data: { name: 'TI, Dados e Infra' } });
      const u = await makeUser('USER', 'pessoa-ti');
      await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: u.id, role: 'PROTETOR', level: 'MEMBRO' } });
      const allowed = await resolveViewerSensitiveAccess(u);
      expect(allowed.has('CPF')).toBe(false);
      expect(allowed.has('RG')).toBe(false);
      expect(allowed.has('SALARY')).toBe(false);
      expect(allowed.size).toBe(0);
    });

    it('usuário sem filiação e papel comum não libera nada', async () => {
      const u = await makeUser('USER', 'comum');
      const allowed = await resolveViewerSensitiveAccess(u);
      expect(allowed.size).toBe(0);
    });

    it("membro do SETOR 'Diretoria' sem o PAPEL global DIRETORIA NÃO libera PII", async () => {
      // Intencional: acesso a PII segue o PAPEL global (ADMIN/DIRETORIA) + função
      // RH — como visibility.ts chaveia visão global por papel, não por setor. A
      // função de fluxo DIRETORIA não consta de nenhuma regra da política.
      const sector = await prisma.sector.create({ data: { name: 'Diretoria' } });
      const u = await makeUser('USER', 'membro-diretoria');
      await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: u.id, role: 'PROTETOR', level: 'MEMBRO' } });
      const allowed = await resolveViewerSensitiveAccess(u);
      expect(allowed.size).toBe(0);
    });

    it('match de papel é case-sensitive exato (fail-safe: variação de caixa nega)', async () => {
      // Documenta a expectativa: seeds/imports devem gravar o papel canônico em
      // CAIXA ALTA. Uma variação como 'hr' não concede acesso (nega, não vaza).
      const u = await makeUser('hr', 'rh-minusculo');
      const allowed = await resolveViewerSensitiveAccess(u);
      expect(allowed.size).toBe(0);
    });
  });

  describe('maskFields', () => {
    it('mascara não-permitidos, mantém permitidos e lista os revelados', () => {
      const record = { nome: 'Fulano', cpf: '123.456.789-09', salario: 500000 };
      const allowed = new Set<SensitiveType>(['CPF']);
      const { masked, revealed } = maskFields(record, { cpf: 'CPF', salario: 'SALARY' }, allowed);

      expect(masked.cpf).toBe('123.456.789-09'); // permitido: intacto
      expect(masked.salario).toBe('R$ ••••••'); // não permitido: mascarado
      expect(masked.nome).toBe('Fulano'); // não registrado: intacto
      expect(revealed).toEqual([{ field: 'cpf', type: 'CPF' }]);
    });

    it('não muta o registro original', () => {
      const record = { cpf: '123.456.789-09' };
      maskFields(record, { cpf: 'CPF' }, new Set());
      expect(record.cpf).toBe('123.456.789-09');
    });
  });

  describe('integração maskRequestForViewer / applyMaskWithRegistry + auditoria', () => {
    // Registro de teste com um campo sensível fabricado na Request.
    const TEST_REGISTRY: Partial<Record<string, SensitiveType>> = { targetEmployee: 'CPF' };

    async function seedRequestWith(cpfLike: string) {
      const initiator = await makeUser('USER', 'iniciador');
      const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
      return prisma.request.create({
        data: { flowId: flow.id, initiatorId: initiator.id, title: 'pedido', status: 'IN_PROGRESS', currentStep: 0, targetEmployee: cpfLike },
      });
    }

    it('espectador TI recebe valor mascarado e gera AuditLog SENSITIVE_VIEW', async () => {
      const request = await seedRequestWith('123.456.789-09');
      const sector = await prisma.sector.create({ data: { name: 'TI, Dados e Infra' } });
      const ti = await makeUser('USER', 'ti');
      await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: ti.id, role: 'PROTETOR', level: 'MEMBRO' } });

      const allowed = await resolveViewerSensitiveAccess(ti);
      const { masked, revealed } = applyMaskWithRegistry(request, TEST_REGISTRY, allowed);

      expect(masked.targetEmployee).toBe('***.***.***-**');
      expect(revealed).toEqual([]); // nada revelado -> não audita
      await recordSensitiveAccess(prisma, { user: ti, requestId: request.id, revealed });
      const logs = await prisma.auditLog.findMany({ where: { requestId: request.id, action: 'SENSITIVE_VIEW' } });
      expect(logs.length).toBe(0);
    });

    it('espectador RH recebe valor intacto e a revelação é auditada', async () => {
      const request = await seedRequestWith('123.456.789-09');
      const sector = await prisma.sector.create({ data: { name: 'RH' } });
      const rh = await makeUser('USER', 'rh');
      await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: rh.id, role: 'PROTETOR', level: 'MEMBRO' } });

      const allowed = await resolveViewerSensitiveAccess(rh);
      const { masked, revealed } = applyMaskWithRegistry(request, TEST_REGISTRY, allowed);

      expect(masked.targetEmployee).toBe('123.456.789-09'); // intacto
      expect(revealed).toEqual([{ field: 'targetEmployee', type: 'CPF' }]);
      await recordSensitiveAccess(prisma, { user: rh, requestId: request.id, revealed });

      const logs = await prisma.auditLog.findMany({ where: { requestId: request.id, action: 'SENSITIVE_VIEW' } });
      expect(logs.length).toBe(1);
      expect(JSON.parse(logs[0].details!)).toEqual({ fields: [{ field: 'targetEmployee', type: 'CPF' }] });
      expect(logs[0].userId).toBe(rh.id);
    });

    it('maskRequestForViewer com registro real (vazio) é no-op verificável', async () => {
      const request = await seedRequestWith('123.456.789-09');
      const ti = await makeUser('USER', 'ti2');
      const result = await maskRequestForViewer(ti, request);
      // Registro de 1ª classe vazio: valor permanece como está e nada é auditado.
      expect(result.targetEmployee).toBe('123.456.789-09');
      const logs = await prisma.auditLog.findMany({ where: { requestId: request.id, action: 'SENSITIVE_VIEW' } });
      expect(logs.length).toBe(0);
    });
  });
});
