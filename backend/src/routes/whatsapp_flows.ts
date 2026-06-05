import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';
import { checkPlan } from '../middleware/plan';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

router.get('/', checkPlan('whatsapp'), checkPermission('whatsapp_flows:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM whatsapp_flows WHERE tenant_id=$1 ORDER BY created_at DESC`,
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', checkPlan('whatsapp'), checkPermission('whatsapp_flows:manage'), async (req: AuthRequest, res: Response) => {
  const { name, trigger, trigger_value, is_active, nodes, root_node_id } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return; }
  try {
    const result = await query(
      `INSERT INTO whatsapp_flows (tenant_id, name, trigger, trigger_value, is_active, nodes, root_node_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user!.tenantId, name.trim(), trigger ?? 'keyword', trigger_value ?? null,
       is_active ?? false, JSON.stringify(nodes ?? []), root_node_id ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/:id', checkPermission('whatsapp_flows:manage'), async (req: AuthRequest, res: Response) => {
  const { name, trigger, trigger_value, is_active, nodes, root_node_id } = req.body;
  const fields: string[] = [];
  const params: any[] = [];

  if (name !== undefined)         { params.push(name);                  fields.push(`name=$${params.length}`); }
  if (trigger !== undefined)      { params.push(trigger);               fields.push(`trigger=$${params.length}`); }
  if (trigger_value !== undefined){ params.push(trigger_value);         fields.push(`trigger_value=$${params.length}`); }
  if (is_active !== undefined)    { params.push(is_active);             fields.push(`is_active=$${params.length}`); }
  if (nodes !== undefined)        { params.push(JSON.stringify(nodes)); fields.push(`nodes=$${params.length}`); }
  if (root_node_id !== undefined) { params.push(root_node_id);         fields.push(`root_node_id=$${params.length}`); }

  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  fields.push(`updated_at=NOW()`);
  params.push(req.params.id, req.user!.tenantId);

  try {
    const result = await query(
      `UPDATE whatsapp_flows SET ${fields.join(',')} WHERE id=$${params.length-1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', checkPermission('whatsapp_flows:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM whatsapp_flows WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user!.tenantId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

export default router;
