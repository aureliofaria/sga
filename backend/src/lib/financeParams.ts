// ============================================================================
// Autorização dos parâmetros financeiros (Fase 0 · Passo 12)
//
// Dois níveis de permissão:
//  • EDITAR (teto/override/delete): ADMIN, DIRETORIA ou o Líder I do setor
//    Financeiro.
//  • VER: ADMIN, DIRETORIA ou QUALQUER membro (qualquer nível) do setor
//    Financeiro.
//
// "Financeiro" é resolvido pelo nome do setor (Sector.name = 'Financeiro').
// Setor inexistente → false (safe default).
// ============================================================================

import prisma from '../lib/prisma';
import { FINANCE_PARAM_EDITORS } from './org';

type Db = typeof prisma;

// Nome canônico do setor financeiro (ver lib/org.ts SECTORS).
const FINANCE_SECTOR_NAME = 'Financeiro';

/**
 * Pode EDITAR parâmetros financeiros (teto, override, exclusão)?
 *
 * true se o papel global está em FINANCE_PARAM_EDITORS (ADMIN, DIRETORIA) OU se
 * o usuário é SectorMember de nível 'LIDER_1' do setor 'Financeiro'.
 */
export async function canEditFinanceParams(user: { id: string; role: string }, db: Db = prisma): Promise<boolean> {
  if ((FINANCE_PARAM_EDITORS as readonly string[]).includes(user.role)) return true;

  const membership = await db.sectorMember.findFirst({
    where: { userId: user.id, level: 'LIDER_1', sector: { name: FINANCE_SECTOR_NAME } },
  });
  return membership != null;
}

/**
 * Pode VER parâmetros financeiros?
 *
 * true se ADMIN/DIRETORIA OU qualquer SectorMember (qualquer nível) do setor
 * 'Financeiro'.
 */
export async function canViewFinanceParams(user: { id: string; role: string }, db: Db = prisma): Promise<boolean> {
  if ((FINANCE_PARAM_EDITORS as readonly string[]).includes(user.role)) return true;

  const membership = await db.sectorMember.findFirst({
    where: { userId: user.id, sector: { name: FINANCE_SECTOR_NAME } },
  });
  return membership != null;
}
