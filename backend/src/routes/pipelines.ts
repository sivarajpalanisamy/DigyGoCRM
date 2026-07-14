import { Router, Response } from 'express';
import { query, pool } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission, hasPermission } from '../middleware/permissions';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// GET /api/pipelines — requires at least one of: view_all or view_own
router.get('/', checkPermission('pipeline:view'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, userId, role } = req.user!;
    const isSuperAdmin = role === 'super_admin';

    const pipelines = await query(
      'SELECT * FROM pipelines WHERE tenant_id=$1 ORDER BY created_at',
      [tenantId]
    );
    const stages = await query(
      'SELECT * FROM pipeline_stages WHERE tenant_id=$1 ORDER BY stage_order',
      [tenantId]
    );
    let result = pipelines.rows.map((p: any) => ({
      ...p,
      stages: stages.rows.filter((s: any) => s.pipeline_id === p.id),
    }));

    // If only_assigned: restrict to pipelines the user has at least one assigned lead in.
    // Skip for super_admin and is_owner — they always see everything.
    if (!isSuperAdmin) {
      let onlyAssigned = false;
      try {
        const ownerCheck = await query('SELECT is_owner FROM users WHERE id=$1 LIMIT 1', [userId]);
        const isOwner = ownerCheck.rows[0]?.is_owner === true;
        if (!isOwner) {
          onlyAssigned = await hasPermission(userId, 'leads:only_assigned', tenantId);
        }
      } catch { onlyAssigned = true; }

      if (onlyAssigned) {
        const assigned = await query(
          `SELECT DISTINCT pipeline_id FROM leads WHERE tenant_id=$1 AND assigned_to=$2 AND is_deleted=FALSE`,
          [tenantId, userId]
        ).catch(() => ({ rows: [] as any[] }));
        const ids = new Set(assigned.rows.map((r: any) => r.pipeline_id));
        result = result.filter((p: any) => ids.has(p.id));
      }
    }

    res.json(result);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/pipelines
router.post('/', checkPermission('pipeline:manage'), async (req: AuthRequest, res: Response) => {
  const { name, stages = ['New Lead', 'Contacted', 'Qualified', 'Won', 'Lost'] } = req.body;
  if (!name) { res.status(400).json({ error: 'Pipeline name required' }); return; }
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const existing = await conn.query(
      'SELECT id FROM pipelines WHERE tenant_id=$1 AND LOWER(name)=LOWER($2) LIMIT 1',
      [req.user!.tenantId, name]
    );
    if (existing.rows.length > 0) {
      await conn.query('ROLLBACK').catch(() => {});
      res.status(409).json({ error: `A pipeline named "${name}" already exists` });
      return; // conn is released once in the finally block below — do NOT release here
    }
    const pRes = await conn.query(
      'INSERT INTO pipelines (tenant_id, name) VALUES ($1,$2) RETURNING *',
      [req.user!.tenantId, name]
    );
    const pipeline = pRes.rows[0];
    const stageRows: any[] = [];
    for (let i = 0; i < stages.length; i++) {
      const stageName = typeof stages[i] === 'string' ? stages[i] : stages[i].name;
      const sRes = await conn.query(
        'INSERT INTO pipeline_stages (pipeline_id, tenant_id, name, stage_order) VALUES ($1,$2,$3,$4) RETURNING *',
        [pipeline.id, req.user!.tenantId, stageName, i]
      );
      stageRows.push(sRes.rows[0]);
    }
    await conn.query('COMMIT');
    res.status(201).json({ ...pipeline, stages: stageRows });
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

// PATCH /api/pipelines/:id
router.patch('/:id', checkPermission('pipeline:manage'), async (req: AuthRequest, res: Response) => {
  const { name, color } = req.body;
  const fields: string[] = [];
  const params: any[] = [];
  if (name !== undefined)  { params.push(name);  fields.push(`name=$${params.length}`); }
  if (color !== undefined) { params.push(color); fields.push(`color=$${params.length}`); }
  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  if (name !== undefined) {
    const dup = await query(
      'SELECT id FROM pipelines WHERE tenant_id=$1 AND LOWER(name)=LOWER($2) AND id<>$3 LIMIT 1',
      [req.user!.tenantId, name, req.params.id]
    );
    if (dup.rows.length > 0) { res.status(409).json({ error: `A pipeline named "${name}" already exists` }); return; }
  }
  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE pipelines SET ${fields.join(',')} WHERE id=$${params.length-1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Pipeline not found' }); return; }
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/pipelines/:id
router.delete('/:id', checkPermission('pipeline:manage'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;
  try {
    // Unlink everything referencing this pipeline OR ANY of its stages before deleting.
    // Deleting the pipeline cascade-deletes pipeline_stages, but leads/forms/opportunities
    // have stage_id FKs with ON DELETE NO ACTION — and a row can hold one of this pipeline's
    // stage_ids even when its pipeline_id is null/different (orphaned by a stage move/import).
    // Matching only on pipeline_id (the old bug) left those orphans behind → FK 500.
    const stagesSub = `(SELECT id FROM pipeline_stages WHERE pipeline_id=$1)`;
    // leads — critical, must succeed (also bumps updated_at)
    await query(
      `UPDATE leads SET pipeline_id=NULL, stage_id=NULL, updated_at=NOW()
       WHERE tenant_id=$2 AND (pipeline_id=$1 OR stage_id IN ${stagesSub})`,
      [id, tenantId]
    );
    // forms + opportunities — best-effort (table/column may not exist in older schemas)
    for (const tbl of ['custom_forms', 'meta_forms', 'opportunities']) {
      await query(
        `UPDATE ${tbl} SET pipeline_id=NULL, stage_id=NULL
         WHERE tenant_id=$2 AND (pipeline_id=$1 OR stage_id IN ${stagesSub})`,
        [id, tenantId]
      ).catch(() => null);
    }
    await query('DELETE FROM pipelines WHERE id=$1 AND tenant_id=$2', [id, tenantId]); // cascades to pipeline_stages
    res.json({ success: true });
  } catch (err: any) {
    console.error('[pipeline delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/pipelines/:id/stages
router.post('/:id/stages', checkPermission('pipeline:manage'), async (req: AuthRequest, res: Response) => {
  const { name, stage_order, color } = req.body;
  if (!name) { res.status(400).json({ error: 'Stage name required' }); return; }
  try {
    const result = await query(
      'INSERT INTO pipeline_stages (pipeline_id, tenant_id, name, stage_order, color) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.params.id, req.user!.tenantId, name, stage_order ?? 0, color ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/pipelines/:id/stages/:stageId
router.patch('/:id/stages/:stageId', checkPermission('pipeline:manage'), async (req: AuthRequest, res: Response) => {
  const { name, stage_order, color, is_won } = req.body;
  const fields: string[] = [];
  const params: any[] = [];
  if (name !== undefined)        { params.push(name);        fields.push(`name=$${params.length}`); }
  if (stage_order !== undefined) { params.push(stage_order); fields.push(`stage_order=$${params.length}`); }
  if (color !== undefined)       { params.push(color);       fields.push(`color=$${params.length}`); }
  if (is_won !== undefined)      { params.push(is_won);      fields.push(`is_won=$${params.length}`); }
  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  params.push(req.params.stageId, req.params.id, req.user!.tenantId);
  try {
    // Only one stage per pipeline can be the won stage — clear others first
    if (is_won === true) {
      await query(
        'UPDATE pipeline_stages SET is_won=FALSE WHERE pipeline_id=$1 AND tenant_id=$2 AND id<>$3',
        [req.params.id, req.user!.tenantId, req.params.stageId]
      );
    }
    const result = await query(
      `UPDATE pipeline_stages SET ${fields.join(',')} WHERE id=$${params.length-2} AND pipeline_id=$${params.length-1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Stage not found' }); return; }
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/pipelines/:id/stages/:stageId
router.delete('/:id/stages/:stageId', checkPermission('pipeline:manage'), async (req: AuthRequest, res: Response) => {
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    // Move leads on this stage to the first remaining stage (so leads aren't lost)
    const remaining = await conn.query(
      'SELECT id FROM pipeline_stages WHERE pipeline_id=$1 AND tenant_id=$2 AND id<>$3 ORDER BY stage_order LIMIT 1',
      [req.params.id, req.user!.tenantId, req.params.stageId]
    );
    if (remaining.rows[0]) {
      await conn.query(
        'UPDATE leads SET stage_id=$1 WHERE stage_id=$2 AND tenant_id=$3',
        [remaining.rows[0].id, req.params.stageId, req.user!.tenantId]
      );
    }
    await conn.query(
      'DELETE FROM pipeline_stages WHERE id=$1 AND pipeline_id=$2 AND tenant_id=$3',
      [req.params.stageId, req.params.id, req.user!.tenantId]
    );
    await conn.query('COMMIT');
    res.json({ success: true });
  } catch {
    await conn.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

export default router;
