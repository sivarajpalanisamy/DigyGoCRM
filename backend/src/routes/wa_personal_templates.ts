import path from 'path';
import fs from 'fs';
import { Router } from 'express';
import multer from 'multer';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

const TEMPLATES_DIR = process.env.WA_MEDIA_DIR
  ? path.join(process.env.WA_MEDIA_DIR, 'templates')
  : path.join(process.cwd(), 'wa_media', 'templates');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// GET /api/wa-personal-templates
router.get('/', checkPermission('automation:view'), async (req: AuthRequest, res) => {
  const tenantId = req.user!.tenantId!;
  const rows = await query(
    `SELECT id, name, message, file_path, file_type, file_name, created_at, updated_at
     FROM wa_personal_templates
     WHERE tenant_id=$1::uuid
     ORDER BY created_at DESC`,
    [tenantId],
  );
  res.json(rows.rows);
});

// GET /api/wa-personal-templates/:id/file — serve stored file
router.get('/:id/file', checkPermission('automation:view'), async (req: AuthRequest, res) => {
  const tenantId = req.user!.tenantId!;
  const { id } = req.params;
  const row = await query(
    `SELECT file_path, file_type, file_name FROM wa_personal_templates WHERE id=$1::uuid AND tenant_id=$2::uuid`,
    [id, tenantId],
  );
  if (!row.rows[0]?.file_path) return res.status(404).json({ error: 'No file attached' });
  const fullPath = path.resolve(process.cwd(), row.rows[0].file_path);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found on disk' });
  res.setHeader('Content-Type', row.rows[0].file_type ?? 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${row.rows[0].file_name ?? 'file'}"`);
  fs.createReadStream(fullPath).pipe(res);
});

// POST /api/wa-personal-templates
router.post('/', checkPermission('automation:manage'), upload.single('file'), async (req: AuthRequest, res) => {
  const tenantId = req.user!.tenantId!;
  const { name, message } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  let filePath: string | null = null;
  let fileType: string | null = null;
  let fileName: string | null = null;

  if (req.file) {
    const tenantDir = path.join(TEMPLATES_DIR, tenantId!);
    fs.mkdirSync(tenantDir, { recursive: true });
    const ext = path.extname(req.file.originalname) || '';
    const storedName = `${uuidv4()}${ext}`;
    const fullPath = path.join(tenantDir, storedName);
    fs.writeFileSync(fullPath, req.file.buffer);
    filePath = path.join('wa_media', 'templates', tenantId!, storedName);
    fileType = req.file.mimetype;
    fileName = req.file.originalname;
  }

  const result = await query(
    `INSERT INTO wa_personal_templates (tenant_id, name, message, file_path, file_type, file_name)
     VALUES ($1::uuid, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantId, name.trim(), message ?? '', filePath, fileType, fileName],
  );
  res.json(result.rows[0]);
});

// PATCH /api/wa-personal-templates/:id
router.patch('/:id', checkPermission('automation:manage'), upload.single('file'), async (req: AuthRequest, res) => {
  const tenantId = req.user!.tenantId!;
  const { id } = req.params;
  const { name, message, removeFile } = req.body;

  const existing = await query(
    `SELECT * FROM wa_personal_templates WHERE id=$1::uuid AND tenant_id=$2::uuid`,
    [id, tenantId],
  );
  if (!existing.rows[0]) return res.status(404).json({ error: 'Template not found' });

  let filePath = existing.rows[0].file_path;
  let fileType = existing.rows[0].file_type;
  let fileName = existing.rows[0].file_name;

  if (removeFile === 'true' || removeFile === true) {
    if (filePath) {
      try { fs.unlinkSync(path.resolve(process.cwd(), filePath)); } catch {}
    }
    filePath = null; fileType = null; fileName = null;
  }

  if (req.file) {
    if (filePath) {
      try { fs.unlinkSync(path.resolve(process.cwd(), filePath)); } catch {}
    }
    const tenantDir = path.join(TEMPLATES_DIR, tenantId!);
    fs.mkdirSync(tenantDir, { recursive: true });
    const ext = path.extname(req.file.originalname) || '';
    const storedName = `${uuidv4()}${ext}`;
    const fullPath = path.join(tenantDir, storedName);
    fs.writeFileSync(fullPath, req.file.buffer);
    filePath = path.join('wa_media', 'templates', tenantId!, storedName);
    fileType = req.file.mimetype;
    fileName = req.file.originalname;
  }

  const result = await query(
    `UPDATE wa_personal_templates
     SET name=$1, message=$2, file_path=$3, file_type=$4, file_name=$5, updated_at=NOW()
     WHERE id=$6::uuid AND tenant_id=$7::uuid
     RETURNING *`,
    [name ?? existing.rows[0].name, message ?? existing.rows[0].message, filePath, fileType, fileName, id, tenantId],
  );
  res.json(result.rows[0]);
});

// DELETE /api/wa-personal-templates/:id
router.delete('/:id', checkPermission('automation:manage'), async (req: AuthRequest, res) => {
  const tenantId = req.user!.tenantId!;
  const { id } = req.params;
  const row = await query(
    `DELETE FROM wa_personal_templates WHERE id=$1::uuid AND tenant_id=$2::uuid RETURNING file_path`,
    [id, tenantId],
  );
  if (row.rows[0]?.file_path) {
    try { fs.unlinkSync(path.resolve(process.cwd(), row.rows[0].file_path)); } catch {}
  }
  res.json({ ok: true });
});

export default router;
