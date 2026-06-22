import path from 'path';
import fs from 'fs';
import https from 'https';
import { Router, Response } from 'express';
import multer from 'multer';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';
import { decrypt } from '../utils/crypto';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

const TEMPLATES_DIR = process.env.WA_MEDIA_DIR
  ? path.join(process.env.WA_MEDIA_DIR, 'tpl_files')
  : path.join(process.cwd(), 'wa_media', 'tpl_files');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function parseJsonField(val: any, fallback: any[] = []) {
  if (!val) return fallback;
  if (typeof val === 'string') { try { return JSON.parse(val); } catch { return fallback; } }
  if (Array.isArray(val)) return val;
  return fallback;
}

// GET /api/templates
router.get('/', checkPermission('automation_templates:read'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, template_type, category, language, status, subject,
              body, header, footer, buttons, variables,
              meta_name, meta_components,
              file_path, file_type, file_name, created_at, updated_at
       FROM templates WHERE tenant_id=$1::uuid ORDER BY created_at DESC`,
      [req.user!.tenantId],
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/templates/:id/file — serve stored file
router.get('/:id/file', checkPermission('automation_templates:read'), async (req: AuthRequest, res: Response) => {
  const row = await query(
    `SELECT file_path, file_type, file_name FROM templates WHERE id=$1::uuid AND tenant_id=$2::uuid`,
    [req.params.id, req.user!.tenantId],
  );
  if (!row.rows[0]?.file_path) return res.status(404).json({ error: 'No file attached' });
  const fullPath = path.resolve(process.cwd(), row.rows[0].file_path);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found on disk' });
  res.setHeader('Content-Type', row.rows[0].file_type ?? 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${row.rows[0].file_name ?? 'file'}"`);
  fs.createReadStream(fullPath).pipe(res);
});

// POST /api/templates
router.post('/', checkPermission('automation_templates:manage'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const { name, template_type = 'waba', category = 'UTILITY', language = 'en', body, subject, header, footer, buttons, variables } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  if (!body?.trim()) { res.status(400).json({ error: 'body is required' }); return; }

  let filePath: string | null = null, fileType: string | null = null, fileName: string | null = null;
  if (req.file) {
    const dir = path.join(TEMPLATES_DIR, tenantId);
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(req.file.originalname) || '';
    const stored = `${uuidv4()}${ext}`;
    fs.writeFileSync(path.join(dir, stored), req.file.buffer);
    filePath = path.join('wa_media', 'tpl_files', tenantId, stored);
    fileType = req.file.mimetype;
    fileName = req.file.originalname;
  }

  try {
    const result = await query(
      `INSERT INTO templates
         (tenant_id, name, template_type, category, language, body, subject, header, footer, buttons, variables, file_path, file_type, file_name)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        tenantId, name.trim(), template_type, category, language, body,
        subject ?? null, header ?? null, footer ?? null,
        JSON.stringify(parseJsonField(buttons)),
        JSON.stringify(parseJsonField(variables)),
        filePath, fileType, fileName,
      ],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/templates/:id
router.patch('/:id', checkPermission('automation_templates:manage'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const { id } = req.params;

  const existing = await query(
    `SELECT * FROM templates WHERE id=$1::uuid AND tenant_id=$2::uuid`,
    [id, tenantId],
  );
  if (!existing.rows[0]) { res.status(404).json({ error: 'Template not found' }); return; }
  const ex = existing.rows[0];

  const { name, body, subject, header, footer, buttons, variables, status, removeFile } = req.body;

  let filePath: string | null = ex.file_path;
  let fileType: string | null = ex.file_type;
  let fileName: string | null = ex.file_name;

  if (removeFile === 'true' || removeFile === true) {
    if (filePath) { try { fs.unlinkSync(path.resolve(process.cwd(), filePath)); } catch {} }
    filePath = null; fileType = null; fileName = null;
  }

  if (req.file) {
    if (filePath) { try { fs.unlinkSync(path.resolve(process.cwd(), filePath)); } catch {} }
    const dir = path.join(TEMPLATES_DIR, tenantId);
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(req.file.originalname) || '';
    const stored = `${uuidv4()}${ext}`;
    fs.writeFileSync(path.join(dir, stored), req.file.buffer);
    filePath = path.join('wa_media', 'tpl_files', tenantId, stored);
    fileType = req.file.mimetype;
    fileName = req.file.originalname;
  }

  const finalButtons = buttons !== undefined
    ? parseJsonField(buttons)
    : parseJsonField(ex.buttons);
  const finalVariables = variables !== undefined
    ? parseJsonField(variables)
    : parseJsonField(ex.variables);

  try {
    const result = await query(
      `UPDATE templates SET
         name=$1, body=$2, subject=$3, header=$4, footer=$5,
         buttons=$6, variables=$7, status=$8,
         file_path=$9, file_type=$10, file_name=$11,
         updated_at=NOW()
       WHERE id=$12::uuid AND tenant_id=$13::uuid
       RETURNING *`,
      [
        name ?? ex.name,
        body ?? ex.body,
        subject !== undefined ? (subject || null) : ex.subject,
        header !== undefined ? (header || null) : ex.header,
        footer !== undefined ? (footer || null) : ex.footer,
        JSON.stringify(finalButtons),
        JSON.stringify(finalVariables),
        status ?? ex.status,
        filePath, fileType, fileName,
        id, tenantId,
      ],
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Template not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/templates/:id
router.delete('/:id', checkPermission('automation_templates:manage'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  try {
    const row = await query(
      `DELETE FROM templates WHERE id=$1::uuid AND tenant_id=$2::uuid RETURNING file_path`,
      [req.params.id, tenantId],
    );
    if (row.rows[0]?.file_path) {
      try { fs.unlinkSync(path.resolve(process.cwd(), row.rows[0].file_path)); } catch {}
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Graph API helper (lightweight, for template sync) ────────────────────────
function graphGet(apiPath: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const sep = apiPath.includes('?') ? '&' : '?';
    const url = `https://graph.facebook.com/v21.0${apiPath}${sep}access_token=${token}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); } });
    }).on('error', reject);
  });
}

// POST /api/templates/sync-waba — pull approved templates from Meta
router.post('/sync-waba', checkPermission('automation_templates:manage'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  try {
    const wabaRes = await query(
      'SELECT waba_id, access_token FROM waba_integrations WHERE tenant_id=$1::uuid AND is_active=TRUE LIMIT 1',
      [tenantId],
    );
    if (!wabaRes.rows[0]) {
      res.status(400).json({ error: 'WhatsApp Business not connected. Set it up under Integrations → WhatsApp.' });
      return;
    }
    const { waba_id, access_token: encToken } = wabaRes.rows[0];
    const token = decrypt(encToken);

    // Fetch all templates from Meta (paginated)
    let allTemplates: any[] = [];
    let nextPath: string | null = `/${waba_id}/message_templates?fields=name,status,category,language,components&limit=100`;
    while (nextPath) {
      const data = await graphGet(nextPath, token);
      if (data.error) {
        res.status(400).json({ error: `Meta API error: ${data.error.message}` });
        return;
      }
      allTemplates.push(...(data.data ?? []));
      const nextUrl: string | undefined = data.paging?.next;
      if (nextUrl) {
        try { nextPath = new URL(nextUrl).pathname + new URL(nextUrl).search; } catch { nextPath = null; }
      } else {
        nextPath = null;
      }
    }

    let synced = 0;
    for (const tpl of allTemplates) {
      const components: any[] = tpl.components ?? [];
      const headerComp = components.find((c: any) => c.type === 'HEADER');
      const bodyComp = components.find((c: any) => c.type === 'BODY');
      const footerComp = components.find((c: any) => c.type === 'FOOTER');
      const buttonsComp = components.find((c: any) => c.type === 'BUTTONS');

      const bodyText = bodyComp?.text ?? '';
      const headerText = headerComp?.format === 'TEXT' ? (headerComp.text ?? null) : null;
      const footerText = footerComp?.text ?? null;
      const buttons = buttonsComp?.buttons ?? [];
      const metaName = tpl.name;
      const lang = tpl.language ?? 'en';
      const category = tpl.category ?? 'UTILITY';
      const status = (tpl.status ?? 'PENDING').toLowerCase();
      const displayName = metaName.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

      await query(
        `INSERT INTO templates
           (tenant_id, name, template_type, category, language, status, body, header, footer, buttons, meta_name, meta_components)
         VALUES ($1::uuid,$2,'waba',$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tenant_id, meta_name, language) DO UPDATE SET
           name=EXCLUDED.name, category=EXCLUDED.category, status=EXCLUDED.status,
           body=EXCLUDED.body, header=EXCLUDED.header, footer=EXCLUDED.footer,
           buttons=EXCLUDED.buttons, meta_components=EXCLUDED.meta_components,
           updated_at=NOW()`,
        [tenantId, displayName, category, lang, status, bodyText, headerText, footerText,
         JSON.stringify(buttons), metaName, JSON.stringify(components)],
      );
      synced++;
    }

    res.json({ success: true, synced, total: allTemplates.length });
  } catch (err: any) {
    console.error('[template sync]', err);
    res.status(500).json({ error: err.message ?? 'Server error' });
  }
});

export default router;
