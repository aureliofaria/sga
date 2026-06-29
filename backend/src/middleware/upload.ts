import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Whitelist de tipos aceitos para anexos. Evita upload de HTML/SVG (XSS armazenado,
// já que os arquivos são servidos estaticamente) e de executáveis.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]);

const ALLOWED_EXT = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

// Erro de tipo não permitido, marcado para virar 400 (e não 500) no handler.
class UnsupportedFileTypeError extends Error {
  code = 'UNSUPPORTED_FILE_TYPE';
  constructor() {
    super('Tipo de arquivo não permitido');
  }
}

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_MIME.has(file.mimetype) && ALLOWED_EXT.has(ext)) {
    cb(null, true);
  } else {
    cb(new UnsupportedFileTypeError());
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Envolve um middleware de upload do multer, traduzindo seus erros (tipo
// inválido, tamanho excedido, etc.) em respostas 400 CLARAS — em vez de deixar
// o erro virar 500 no handler genérico. Mantém o sucesso intacto.
export function handleUpload(mw: (req: Request, res: Response, cb: (err: any) => void) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    mw(req, res, (err: any) => {
      if (!err) return next();
      if (err.code === 'UNSUPPORTED_FILE_TYPE') {
        res.status(400).json({ error: 'Tipo de arquivo não permitido' });
        return;
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'Arquivo excede o tamanho máximo permitido (10 MB)' });
        return;
      }
      if (err instanceof multer.MulterError) {
        res.status(400).json({ error: `Falha no upload: ${err.message}` });
        return;
      }
      next(err);
    });
  };
}
