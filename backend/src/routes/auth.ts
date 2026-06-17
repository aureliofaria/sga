import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { serializeUser } from '../lib/users';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'aprova-secret-2024';

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email e senha são obrigatórios' });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { email },
      include: { department: true },
    });
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: serializeUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password, role, departmentId } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
      return;
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Email já cadastrado' });
      return;
    }
    const count = await prisma.user.count();
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: count === 0 ? 'ADMIN' : (role || 'USER'),
        departmentId: departmentId || null,
      },
      include: { department: true },
    });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: serializeUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  res.json(serializeUser(req.user));
});

export default router;
