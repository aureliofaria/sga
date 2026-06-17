import { Router, Request as ExpressRequest, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

const uploadDir = path.join(__dirname, '../../uploads');

// Wraps multer so its errors (e.g. rejected MIME type, size limit) become
// clean 400 responses instead of unhandled exceptions (audit finding M1).
const handleUpload = (req: ExpressRequest, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Falha no upload' });
      return;
    }
    next();
  });
};

router.post('/', authenticate, handleUpload, async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  const file = (req as ExpressRequest & { file?: Express.Multer.File }).file;
  try {
    if (!file) {
      res.status(400).json({ error: 'Arquivo é obrigatório' });
      return;
    }
    const { requestId, taskId } = req.body as { requestId?: string; taskId?: string };
    if (!requestId && !taskId) {
      fs.unlink(file.path, () => undefined);
      res.status(400).json({ error: 'Informe requestId ou taskId' });
      return;
    }
    const attachment = await prisma.attachment.create({
      data: {
        requestId: requestId || null,
        taskId: taskId || null,
        fileName: file.filename,
        originalName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        storagePath: file.path,
        uploadedBy: user.id,
      },
    });
    res.status(201).json(attachment);
  } catch {
    if (file) fs.unlink(file.path, () => undefined);
    res.status(500).json({ error: 'Erro ao salvar anexo' });
  }
});

router.get('/:id/download', authenticate, async (req: ExpressRequest, res: Response) => {
  try {
    const attachment = await prisma.attachment.findUnique({ where: { id: req.params.id } });
    if (!attachment) {
      res.status(404).json({ error: 'Anexo não encontrado' });
      return;
    }
    const resolved = path.resolve(attachment.storagePath);
    // Ensure the stored path never escapes the uploads directory.
    if (!resolved.startsWith(path.resolve(uploadDir)) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Arquivo indisponível' });
      return;
    }
    // Force download to neutralize any in-browser rendering of the content.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.download(resolved, attachment.originalName);
  } catch {
    res.status(500).json({ error: 'Erro ao baixar anexo' });
  }
});

export default router;
