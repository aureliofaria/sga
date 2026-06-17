import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { config } from '../config';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateBody } from '../lib/validate';

const router = Router();

function signToken(userId: string): string {
  const options: jwt.SignOptions = {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign({ userId }, config.jwtSecret, options);
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', validateBody(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
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
    const token = signToken(user.id);
    const { passwordHash: _ph, ...userOut } = user;
    res.json({ token, user: userOut });
  } catch {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres'),
  departmentId: z.string().optional(),
});

/**
 * Public self-registration.
 *
 * SECURITY (audit finding C2): the role is NEVER taken from the request body.
 * The very first user to register bootstraps the system as ADMIN; everyone
 * else is created as a plain USER. Privileged roles (MANAGER, DIRETOR, CFO…)
 * can only be granted by an existing ADMIN through the authenticated
 * /api/users endpoints.
 */
router.post('/register', validateBody(registerSchema), async (req: Request, res: Response) => {
  try {
    const { name, email, password, departmentId } = req.body;
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
        role: count === 0 ? 'ADMIN' : 'USER',
        departmentId: departmentId || null,
      },
      include: { department: true },
    });
    const token = signToken(user.id);
    const { passwordHash: _ph, ...userOut } = user;
    res.status(201).json({ token, user: userOut });
  } catch {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/me', authenticate, async (req: Request, res: Response) => {
  const { passwordHash: _ph, ...userOut } = (req as AuthRequest).user as Record<string, unknown>;
  res.json(userOut);
});

export default router;
