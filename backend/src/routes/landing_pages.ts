import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// GET /api/landing-pages
router.get('/', checkPermission('landing_pages:read'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM landing_pages WHERE tenant_id=$1 AND is_deleted=FALSE ORDER BY created_at DESC`,
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch (err: any) {
    if (err.code === '42P01') { res.json([]); return; }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/landing-pages/:id
router.get('/:id', checkPermission('landing_pages:read'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM landing_pages WHERE id=$1::uuid AND tenant_id=$2 AND is_deleted=FALSE`,
      [req.params.id, req.user!.tenantId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Page not found' }); return; }
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[get landing page]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/landing-pages
router.post('/', checkPermission('landing_pages:create'), async (req: AuthRequest, res: Response) => {
  const { title, slug, template, status, content } = req.body;
  if (!title?.trim()) { res.status(400).json({ error: 'title required' }); return; }
  if (status && !['draft', 'published'].includes(status)) {
    res.status(400).json({ error: 'status must be draft or published' }); return;
  }
  // Generate globally unique slug (slugs are shared URL namespace across all tenants)
  let baseSlug = (slug ?? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  let finalSlug = baseSlug;
  let n = 1;
  try {
    while (true) {
      const chk = await query('SELECT id FROM landing_pages WHERE slug=$1', [finalSlug]);
      if (!chk.rows.length) break;
      n++;
      finalSlug = `${baseSlug}-${n}`;
    }
    // Normalize content: ensure it's stored as JSONB-compatible object
    const contentValue = typeof content === 'string' ? content : JSON.stringify(content ?? {});
    const result = await query(
      `INSERT INTO landing_pages (tenant_id, title, slug, template, status, content)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user!.tenantId, title.trim(), finalSlug, template ?? 'Lead Capture',
       status ?? 'draft', contentValue]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    console.error('[create landing page]', err.message);
    if (err.code === '23505') { res.status(409).json({ error: 'A page with this slug already exists' }); }
    else { res.status(500).json({ error: 'Server error' }); }
  }
});

// PATCH /api/landing-pages/:id
router.patch('/:id', checkPermission('landing_pages:edit'), async (req: AuthRequest, res: Response) => {
  const { title, slug, template, status, content } = req.body;
  const fields: string[] = [];
  const params: any[] = [];

  if (title !== undefined) {
    if (!title?.trim()) { res.status(400).json({ error: 'title cannot be empty' }); return; }
    params.push(title.trim()); fields.push(`title=$${params.length}`);
  }
  if (slug !== undefined)     { params.push(slug);                     fields.push(`slug=$${params.length}`); }
  if (template !== undefined) { params.push(template);                 fields.push(`template=$${params.length}`); }
  if (status !== undefined) {
    if (!['draft', 'published'].includes(status)) { res.status(400).json({ error: 'status must be draft or published' }); return; }
    params.push(status); fields.push(`status=$${params.length}`);
  }
  if (content !== undefined) {
    const contentValue = typeof content === 'string' ? content : JSON.stringify(content);
    params.push(contentValue); fields.push(`content=$${params.length}`);
  }

  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  fields.push(`updated_at=NOW()`);
  params.push(req.params.id, req.user!.tenantId);

  try {
    const result = await query(
      `UPDATE landing_pages SET ${fields.join(',')} WHERE id=$${params.length - 1}::uuid AND tenant_id=$${params.length} AND is_deleted=FALSE RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[patch landing page]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/landing-pages/:id — soft delete
router.delete('/:id', checkPermission('landing_pages:delete'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `UPDATE landing_pages SET is_deleted=TRUE, updated_at=NOW() WHERE id=$1::uuid AND tenant_id=$2 AND is_deleted=FALSE RETURNING id`,
      [req.params.id, req.user!.tenantId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Page not found' }); return; }
    res.json({ success: true });
  } catch (err: any) {
    console.error('[delete landing page]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
