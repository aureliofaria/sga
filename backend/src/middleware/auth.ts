import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { config } from '../config';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  departmentId: string | null;
  isActive: boolean;
  [key: string]: unknown;
}

// Augment Express's Request so `user` (populated by `authenticate`) is part of
// the base type. This keeps route handlers assignable to Express's
// RequestHandler under `strict` while still typing the user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: AuthUser;
    }
  }
}

// Kept as an alias for readability and backwards compatibility in routes.
export type AuthRequest = Request;

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { userId: string };
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { department: true },
    });
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Usuário inativo' });
      return;
    }
    (req as AuthRequest).user = user as unknown as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
};

export const requireRole =
  (...roles: string[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthRequest).user;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }
    next();
  };
