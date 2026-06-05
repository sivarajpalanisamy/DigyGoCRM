import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// GET /api/pincode-routing — list all mappings + stats
router.get('/', checkPermission('routing:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT pincode, district, state, pipeline_name
       FROM pincode_district_map
       WHERE tenant_id=$1
       ORDER BY district ASC, pincode ASC`,
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch (err: any) {
    if (err.code === '42P01') { res.json([]); return; }
    res.status(500).json({ error: 'Failed to fetch pincode mappings' });
  }
});

// GET /api/pincode-routing/stats — count summary by district
router.get('/stats', checkPermission('routing:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT district, state, pipeline_name, COUNT(*) AS pincode_count
       FROM pincode_district_map
       WHERE tenant_id=$1
       GROUP BY district, state, pipeline_name
       ORDER BY district ASC`,
      [req.user!.tenantId]
    );
    const total = await query(
      `SELECT COUNT(*) AS total FROM pincode_district_map WHERE tenant_id=$1`,
      [req.user!.tenantId]
    );
    res.json({ districts: result.rows, total: parseInt(total.rows[0]?.total ?? '0') });
  } catch (err: any) {
    if (err.code === '42P01') { res.json({ districts: [], total: 0 }); return; }
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/pincode-routing/lookup/:pincode — test a single pincode
router.get('/lookup/:pincode', checkPermission('routing:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT pincode, district, state, pipeline_name
       FROM pincode_district_map
       WHERE tenant_id=$1 AND pincode=$2`,
      [req.user!.tenantId, req.params.pincode.trim()]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: `Pincode ${req.params.pincode} not found` });
      return;
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '42P01') { res.status(404).json({ error: 'No pincode data uploaded yet' }); return; }
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// POST /api/pincode-routing/upload — bulk upsert from frontend-parsed Excel
// Body: { rows: [{ pincode, district, state?, pipeline_name? }] }
router.post('/upload', checkPermission('routing:manage'), async (req: AuthRequest, res: Response) => {
  const { rows } = req.body as { rows?: any[] };
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'rows array is required' }); return;
  }

  const tenantId = req.user!.tenantId;
  let inserted = 0;
  let skipped = 0;

  try {
    // Batch upsert in chunks of 500
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const values: any[] = [];
      const placeholders: string[] = [];

      for (const row of chunk) {
        const pincode = String(row.pincode ?? '').trim();
        const district = String(row.district ?? '').trim();
        if (!pincode || !district) { skipped++; continue; }
        const state = String(row.state ?? '').trim() || null;
        const pipeline = String(row.pipeline_name ?? row.pipeline ?? '').trim() || null;
        const base = values.length;
        values.push(tenantId, pincode, district, state, pipeline);
        placeholders.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5})`);
      }

      if (placeholders.length > 0) {
        await query(
          `INSERT INTO pincode_district_map (tenant_id, pincode, district, state, pipeline_name)
           VALUES ${placeholders.join(',')}
           ON CONFLICT (tenant_id, pincode) DO UPDATE
             SET district=EXCLUDED.district, state=EXCLUDED.state, pipeline_name=EXCLUDED.pipeline_name`,
          values
        );
        inserted += placeholders.length;
      }
    }

    res.json({ inserted, skipped, total: inserted + skipped });
  } catch (err: any) {
    console.error('[pincode-routing/upload]', err.message);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// DELETE /api/pincode-routing — clear all mappings for this tenant
router.delete('/', checkPermission('routing:manage'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM pincode_district_map WHERE tenant_id=$1`,
      [req.user!.tenantId]
    );
    res.json({ deleted: result.rowCount ?? 0 });
  } catch (err: any) {
    if (err.code === '42P01') { res.json({ deleted: 0 }); return; }
    res.status(500).json({ error: 'Failed to clear mappings' });
  }
});

export default router;
