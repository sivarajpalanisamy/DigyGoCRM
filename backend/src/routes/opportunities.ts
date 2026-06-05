import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// GET /api/opportunities?lead_id=uuid
router.get('/', checkPermission('opportunities:read'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { lead_id } = req.query as Record<string, string>;
  try {
    const result = lead_id
      ? await query(
          `SELECT o.*, u.name AS assigned_name
           FROM opportunities o
           LEFT JOIN users u ON u.id = o.assigned_to
           WHERE o.tenant_id = $1 AND o.lead_id = $2
           ORDER BY o.created_at DESC`,
          [tenantId, lead_id]
        )
      : await query(
          `SELECT o.*, u.name AS assigned_name
           FROM opportunities o
           LEFT JOIN users u ON u.id = o.assigned_to
           WHERE o.tenant_id = $1
           ORDER BY o.created_at DESC`,
          [tenantId]
        );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/opportunities
router.post('/', checkPermission('opportunities:create'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const {
    lead_id, title, value, currency = 'INR',
    pipeline_id, stage_id, expected_close_date,
    probability = 0, assigned_to,
  } = req.body;

  if (!lead_id || !title || value === undefined) {
    res.status(400).json({ error: 'lead_id, title, and value are required' });
    return;
  }
  try {
    const result = await query(
      `INSERT INTO opportunities
         (tenant_id, lead_id, title, value, currency, pipeline_id, stage_id,
          expected_close_date, probability, assigned_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        tenantId, lead_id, title, Number(value), currency,
        pipeline_id ?? null, stage_id ?? null,
        expected_close_date ?? null, Number(probability),
        assigned_to ?? userId,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/opportunities/:id
router.patch('/:id', checkPermission('opportunities:edit'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const allowed = [
    'title', 'value', 'currency', 'pipeline_id', 'stage_id',
    'expected_close_date', 'probability', 'status', 'lost_reason', 'assigned_to',
  ];
  const updates: string[] = [];
  const params: any[] = [];

  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      params.push(req.body[field]);
      updates.push(`${field} = $${params.length}`);
    }
  }
  if (!updates.length) { res.status(400).json({ error: 'No fields to update' }); return; }

  params.push(req.params.id, tenantId);
  try {
    const result = await query(
      `UPDATE opportunities SET ${updates.join(', ')}
       WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
       RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Opportunity not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/opportunities/:id
router.delete('/:id', checkPermission('opportunities:delete'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  try {
    await query(
      'DELETE FROM opportunities WHERE id = $1 AND tenant_id = $2',
      [req.params.id, tenantId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
