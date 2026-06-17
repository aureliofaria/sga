import { Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { AuthRequest } from '../middleware/auth';

/**
 * Express middleware factory that validates `req.body` against a Zod schema.
 * On success the parsed (and coerced) value replaces `req.body`. On failure
 * a 400 is returned with the field-level issues (audit finding M2).
 */
export const validateBody =
  (schema: ZodSchema) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Dados inválidos',
        issues: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
