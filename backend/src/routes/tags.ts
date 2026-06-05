import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// GET /api/tags
router.get('/', checkPermission('tags:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT t.*, COUNT(lt.lead_id)::int AS lead_count
       FROM tags t
       LEFT JOIN lead_tags lt ON lt.tag_id = t.id
       WHERE t.tenant_id = $1
       GROUP BY t.id
       ORDER BY t.name`,
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tags
router.post('/', checkPermission('tags:manage'), async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    name:  z.string().min(1).max(100),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#94a3b8'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input' }); return; }
  try {
    const result = await query(
      `INSERT INTO tags (tenant_id, name, color) VALUES ($1, $2, $3) RETURNING *`,
      [req.user!.tenantId, parsed.data.name, parsed.data.color]
    );
    res.status(201).json({ ...result.rows[0], lead_count: 0 });
  } catch (err: any) {
    if (err.code === '23505') { res.status(409).json({ error: 'Tag name already exists' }); }
    else { res.status(500).json({ error: 'Server error' }); }
  }
});

// PATCH /api/tags/:id
router.patch('/:id', checkPermission('tags:manage'), async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    name:  z.string().min(1).max(100).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input' }); return; }

  const updates: string[] = [];
  const params: any[] = [];
  if (parsed.data.name !== undefined)  { params.push(parsed.data.name);  updates.push(`name=$${params.length}`); }
  if (parsed.data.color !== undefined) { params.push(parsed.data.color); updates.push(`color=$${params.length}`); }
  if (!updates.length) { res.status(400).json({ error: 'Nothing to update' }); return; }

  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE tags SET ${updates.join(', ')} WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Tag not found' }); return; }
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') { res.status(409).json({ error: 'Tag name already exists' }); }
    else { res.status(500).json({ error: 'Server error' }); }
  }
});

// DELETE /api/tags/:id
router.delete('/:id', checkPermission('tags:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query(
      'DELETE FROM tags WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.user!.tenantId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tags/leads/:leadId — add tag to lead
router.post('/leads/:leadId', checkPermission('leads:edit'), async (req: AuthRequest, res: Response) => {
  const schema = z.object({ tag_id: z.string().uuid() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'tag_id (UUID) required' }); return; }
  try {
    await query(
      `INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.leadId, parsed.data.tag_id]
    );
    await query(
      `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
       SELECT $1, $2, 'tag_added', 'Tag added: ' || t.name, $3
       FROM tags t WHERE t.id = $4`,
      [req.params.leadId, req.user!.tenantId, req.user!.userId, parsed.data.tag_id]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/tags/leads/:leadId/:tagId — remove tag from lead
router.delete('/leads/:leadId/:tagId', checkPermission('leads:edit'), async (req: AuthRequest, res: Response) => {
  try {
    await query(
      'DELETE FROM lead_tags WHERE lead_id=$1 AND tag_id=$2',
      [req.params.leadId, req.params.tagId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
