import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// GET /api/assignment-rules
router.get('/', checkPermission('assignment_rules:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT ar.*, u.name AS assign_to_name
       FROM assignment_rules ar
       LEFT JOIN users u ON u.id = ar.assign_to
       WHERE ar.tenant_id = $1 ORDER BY ar.sort_order ASC, ar.created_at ASC`,
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/assignment-rules
router.post('/', checkPermission('assignment_rules:manage'), async (req: AuthRequest, res: Response) => {
  const { name, method, condition, assign_to, sort_order } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  try {
    const result = await query(
      `INSERT INTO assignment_rules (tenant_id, name, method, condition, assign_to, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user!.tenantId, name, method ?? 'source', condition ?? null, assign_to ?? null, sort_order ?? 0]
    );
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/assignment-rules/:id
router.patch('/:id', checkPermission('assignment_rules:manage'), async (req: AuthRequest, res: Response) => {
  const allowed = ['name', 'method', 'condition', 'assign_to', 'sort_order', 'is_active'];
  const fields: string[] = [];
  const params: any[] = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { params.push(req.body[key]); fields.push(`${key}=$${params.length}`); }
  }
  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  fields.push('updated_at=NOW()');
  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE assignment_rules SET ${fields.join(',')} WHERE id=$${params.length-1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Rule not found' }); return; }
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/assignment-rules/:id
router.delete('/:id', checkPermission('assignment_rules:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM assignment_rules WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user!.tenantId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

export default router;
