import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { serializeUser, normalizeRequestPermissions } from '../lib/users';
import { isValidRole } from '../lib/org';

const router = Router();

router.get('/', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      include: { department: true },
      orderBy: { name: 'asc' },
    });
    res.json(users.map(serializeUser));
  } catch {
    res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { department: true },
    });
    if (!user) { res.status(404).json({ error: 'Usuário não encontrado' }); return; }
    res.json(serializeUser(user));
  } catch {
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

router.post('/', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password, role, departmentId, requestPermissions } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
      return;
    }
    if (role && !isValidRole(role)) { res.status(400).json({ error: 'Papel inválido' }); return; }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) { res.status(409).json({ error: 'Email já cadastrado' }); return; }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name, email, passwordHash,
        role: role || 'USER',
        departmentId: departmentId || null,
        requestPermissions: requestPermissions !== undefined ? normalizeRequestPermissions(requestPermissions) : null,
      },
      include: { department: true },
    });
    res.status(201).json(serializeUser(user));
  } catch {
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const isSelf = req.user.id === req.params.id;
    const isAdmin = req.user.role === 'ADMIN';
    if (!isSelf && !isAdmin) { res.status(403).json({ error: 'Acesso negado' }); return; }
    const { name, email, role, departmentId, isActive, password, requestPermissions } = req.body;
    if (role && !isValidRole(role)) { res.status(400).json({ error: 'Papel inválido' }); return; }
    const data: any = {};
    if (name) data.name = name;
    if (email) data.email = email;
    if (isAdmin && role) data.role = role;
    if (isAdmin && departmentId !== undefined) data.departmentId = departmentId;
    if (isAdmin && isActive !== undefined) data.isActive = isActive;
    if (isAdmin && requestPermissions !== undefined) data.requestPermissions = normalizeRequestPermissions(requestPermissions);
    if (password) data.passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      include: { department: true },
    });
    res.json(serializeUser(user));
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

router.delete('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: 'Usuário desativado com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao desativar usuário' });
  }
});

export default router;
