import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

function slugify(s: string): string {
  const base = (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return base || 'field';
}

// Create custom-field definitions for columns the user mapped to a new field.
// Idempotent — existing slugs are left untouched.
async function ensureCustomFields(
  tenantId: string | null | undefined,
  fields: Array<{ name?: string; slug?: string; type?: string }>,
): Promise<void> {
  for (const f of fields) {
    const slug = (f.slug || slugify(f.name ?? '')).slice(0, 100);
    if (!slug) continue;
    const name = (f.name || slug).slice(0, 255);
    try {
      await query(
        `INSERT INTO custom_fields (tenant_id, name, type, slug, required)
         VALUES ($1,$2,$3,$4,false) ON CONFLICT (tenant_id, slug) DO NOTHING`,
        [tenantId, name, f.type || 'Single Line', slug],
      );
    } catch (err: any) {
      console.error('[field-routing] ensureCustomFields', slug, err.message);
    }
  }
}

// ── GET /api/field-routing/sets ──────────────────────────────────────────────
router.get('/sets', checkPermission('routing:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, match_field, match_type, row_count, times_used, created_at, updated_at
       FROM field_routing_sets
       WHERE tenant_id=$1
       ORDER BY created_at DESC`,
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch (err: any) {
    if (err.code === '42P01') { res.json([]); return; }
    res.status(500).json({ error: 'Failed to fetch routing sets' });
  }
});

// ── POST /api/field-routing/sets ─────────────────────────────────────────────
router.post('/sets', checkPermission('routing:manage'), async (req: AuthRequest, res: Response) => {
  const { name, match_field = 'pincode', match_type = 'exact' } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  try {
    const result = await query(
      `INSERT INTO field_routing_sets (tenant_id, name, match_field, match_type)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user!.tenantId, name.trim(), match_field.trim(), match_type]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create routing set' });
  }
});

// ── PATCH /api/field-routing/sets/:id ────────────────────────────────────────
router.patch('/sets/:id', checkPermission('routing:manage'), async (req: AuthRequest, res: Response) => {
  const { name, match_field, match_type } = req.body;
  const sets: string[] = [];
  const params: any[] = [];
  if (name?.trim())        { params.push(name.trim());        sets.push(`name=$${params.length}`); }
  if (match_field?.trim()) { params.push(match_field.trim()); sets.push(`match_field=$${params.length}`); }
  if (match_type)          { params.push(match_type);         sets.push(`match_type=$${params.length}`); }
  if (sets.length === 0)   { res.status(400).json({ error: 'Nothing to update' }); return; }
  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE field_routing_sets SET ${sets.join(',')}, updated_at=NOW()
       WHERE id=$${params.length - 1}::uuid AND tenant_id=$${params.length}::uuid
       RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Set not found' }); return; }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update routing set' });
  }
});

// ── DELETE /api/field-routing/sets/:id ───────────────────────────────────────
router.delete('/sets/:id', checkPermission('routing:manage'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM field_routing_sets WHERE id=$1::uuid AND tenant_id=$2::uuid RETURNING id`,
      [req.params.id, req.user!.tenantId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Set not found' }); return; }
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete routing set' });
  }
});

// ── POST /api/field-routing/sets/:id/upload ──────────────────────────────────
// Body: { rows: [{ match_value, pipeline_name?, district?, state?, meta?: {slug:value} }],
//         create_fields?: [{name,slug,type}], replace?: boolean }
router.post('/sets/:id/upload', checkPermission('routing:manage'), async (req: AuthRequest, res: Response) => {
  const { rows, replace = false, create_fields } = req.body as { rows?: any[]; replace?: boolean; create_fields?: any[] };
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'rows array is required' }); return;
  }
  const tenantId = req.user!.tenantId;
  const setId = req.params.id;

  const setCheck = await query(
    `SELECT id FROM field_routing_sets WHERE id=$1::uuid AND tenant_id=$2::uuid`,
    [setId, tenantId]
  ).catch(() => ({ rows: [] as any[] }));
  if (!setCheck.rows[0]) { res.status(404).json({ error: 'Routing set not found' }); return; }

  // Register any new custom fields the user mapped extra columns to.
  if (Array.isArray(create_fields) && create_fields.length) {
    await ensureCustomFields(tenantId, create_fields);
  }

  try {
    if (replace) {
      await query(`DELETE FROM field_routing_rows WHERE set_id=$1::uuid`, [setId]);
    }

    let inserted = 0;
    let skipped = 0;
    const chunkSize = 500;

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const values: any[] = [];
      const placeholders: string[] = [];

      for (const row of chunk) {
        const matchValue = String(row.match_value ?? '').trim();
        if (!matchValue) { skipped++; continue; }
        const pipelineName = String(row.pipeline_name ?? row.pipeline ?? '').trim() || null;
        const district     = String(row.district ?? '').trim() || null;
        const state        = String(row.state ?? '').trim() || null;
        // Extra named fields: { slug: value } — drop empties.
        const meta: Record<string, string> = {};
        if (row.meta && typeof row.meta === 'object') {
          for (const [k, v] of Object.entries(row.meta)) {
            const val = String(v ?? '').trim();
            if (k && val) meta[k] = val;
          }
        }
        const base = values.length;
        values.push(setId, tenantId, matchValue, pipelineName, district, state, JSON.stringify(meta));
        placeholders.push(`($${base+1}::uuid,$${base+2}::uuid,$${base+3},$${base+4},$${base+5},$${base+6},$${base+7}::jsonb)`);
      }

      if (placeholders.length > 0) {
        await query(
          `INSERT INTO field_routing_rows (set_id, tenant_id, match_value, pipeline_name, district, state, meta)
           VALUES ${placeholders.join(',')}
           ON CONFLICT (set_id, lower(match_value)) DO UPDATE
             SET pipeline_name=EXCLUDED.pipeline_name,
                 district=EXCLUDED.district,
                 state=EXCLUDED.state,
                 meta=EXCLUDED.meta`,
          values
        );
        inserted += placeholders.length;
      }
    }

    await query(
      `UPDATE field_routing_sets
       SET row_count=(SELECT COUNT(*) FROM field_routing_rows WHERE set_id=$1::uuid),
           updated_at=NOW()
       WHERE id=$1::uuid`,
      [setId]
    );

    res.json({ inserted, skipped, total: inserted + skipped });
  } catch (err: any) {
    console.error('[field-routing/upload]', err.message);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ── GET /api/field-routing/sets/:id/rows?page=1&limit=50&search= ─────────────
router.get('/sets/:id/rows', checkPermission('routing:view'), async (req: AuthRequest, res: Response) => {
  const page   = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit  = Math.min(200, parseInt(req.query.limit as string) || 50);
  const search = (req.query.search as string ?? '').trim().toLowerCase();
  const offset = (page - 1) * limit;

  try {
    const params: any[] = [req.params.id, req.user!.tenantId];
    let whereExtra = '';
    if (search) {
      params.push(`%${search}%`);
      whereExtra = ` AND (LOWER(match_value) LIKE $${params.length} OR LOWER(COALESCE(pipeline_name,'')) LIKE $${params.length} OR LOWER(COALESCE(district,'')) LIKE $${params.length})`;
    }

    const rowsParams = [...params, limit, offset];
    const [rowsRes, countRes] = await Promise.all([
      query(
        `SELECT id, match_value, pipeline_name, district, state, meta
         FROM field_routing_rows
         WHERE set_id=$1::uuid AND tenant_id=$2::uuid${whereExtra}
         ORDER BY match_value ASC
         LIMIT $${rowsParams.length - 1} OFFSET $${rowsParams.length}`,
        rowsParams
      ),
      query(
        `SELECT COUNT(*) AS total FROM field_routing_rows
         WHERE set_id=$1::uuid AND tenant_id=$2::uuid${whereExtra}`,
        params
      ),
    ]);
    res.json({ rows: rowsRes.rows, total: parseInt(countRes.rows[0]?.total ?? '0'), page, limit });
  } catch (err: any) {
    if (err.code === '42P01') { res.json({ rows: [], total: 0, page: 1, limit }); return; }
    res.status(500).json({ error: 'Failed to fetch rows' });
  }
});

// ── GET /api/field-routing/sets/:id/export ────────────────────────────────────
router.get('/sets/:id/export', checkPermission('routing:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT match_value, pipeline_name, district, state, meta
       FROM field_routing_rows
       WHERE set_id=$1::uuid AND tenant_id=$2::uuid
       ORDER BY match_value ASC`,
      [req.params.id, req.user!.tenantId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to export rows' });
  }
});

// ── POST /api/field-routing/sets/:id/test ─────────────────────────────────────
router.post('/sets/:id/test', checkPermission('routing:view'), async (req: AuthRequest, res: Response) => {
  const { value, match_type = 'exact' } = req.body;
  if (!value?.trim()) { res.status(400).json({ error: 'value is required' }); return; }

  try {
    let result;
    if (match_type === 'contains') {
      result = await query(
        `SELECT match_value, pipeline_name, district, state, meta
         FROM field_routing_rows
         WHERE set_id=$1::uuid AND tenant_id=$2::uuid
           AND (LOWER($3) LIKE '%' || LOWER(match_value) || '%'
             OR LOWER(match_value) LIKE '%' || LOWER($3) || '%')
         ORDER BY length(match_value) DESC LIMIT 1`,
        [req.params.id, req.user!.tenantId, value.trim()]
      );
    } else {
      result = await query(
        `SELECT match_value, pipeline_name, district, state, meta
         FROM field_routing_rows
         WHERE set_id=$1::uuid AND tenant_id=$2::uuid AND LOWER(match_value)=LOWER($3)`,
        [req.params.id, req.user!.tenantId, value.trim()]
      );
    }
    if (!result.rows[0]) {
      res.status(404).json({ error: `"${value}" not found in this routing set` });
      return;
    }
    res.json({ found: true, ...result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Test lookup failed' });
  }
});

export default router;
