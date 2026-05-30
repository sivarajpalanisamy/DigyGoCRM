import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';

const router = Router();
router.use(requireAuth);

// GET /api/fields/link-preview?url=... — only needs auth, no tenant required
// Proxy to avoid CORS; returns OG metadata for the template editor live preview.
// YouTube URLs use their oEmbed API (returns real title + thumbnail server-side).
// All other URLs fall back to link-preview-js OG scraping.
router.get('/link-preview', async (req: AuthRequest, res: Response) => {
  const url = req.query.url as string;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const isYouTube = /youtube\.com|youtu\.be/i.test(url);

  try {
    if (isYouTube) {
      // YouTube oEmbed: public, no auth, returns real title + thumbnail
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const r = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('oEmbed failed');
      const d = await r.json() as any;
      return res.json({
        title:       d.title           ?? null,
        description: d.author_name ? `By ${d.author_name}` : null,
        image:       d.thumbnail_url   ?? null,
        siteName:    'YouTube',
        url,
      });
    }

    // Generic OG scrape for all other URLs
    const { getLinkPreview } = await import('link-preview-js');
    const data = await getLinkPreview(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhatsApp/2.24.6)' },
    }) as any;
    return res.json({
      title:       data.title       ?? null,
      description: data.description ?? null,
      image:       Array.isArray(data.images) && data.images.length ? data.images[0] : null,
      siteName:    data.siteName    ?? null,
      url:         data.url         ?? url,
    });
  } catch {
    return res.status(422).json({ error: 'Could not fetch preview' });
  }
});

router.use(requireTenant);

// ── System Fields (single source of truth — same for every tenant) ────────────

const SYSTEM_FIELDS = [
  { id: 'c00',  name: 'Full Name',            slug: 'contact.full_name',          group: 'Contact' },
  { id: 'c01',  name: 'First Name',           slug: 'contact.first_name',         group: 'Contact' },
  { id: 'c02',  name: 'Last Name',            slug: 'contact.last_name',          group: 'Contact' },
  { id: 'c03',  name: 'Email',                slug: 'contact.email',              group: 'Contact' },
  { id: 'c04',  name: 'Phone',                slug: 'contact.phone',              group: 'Contact' },
  { id: 'c05',  name: 'Contact Source',       slug: 'contact.contact_source',     group: 'Contact' },
  { id: 'c06',  name: 'Opportunity Name',     slug: 'contact.opportunity_name',   group: 'Contact' },
  { id: 'c07',  name: 'Lead Value',           slug: 'contact.lead_value',         group: 'Contact' },
  { id: 'c08',  name: 'Assigned to Staff',    slug: 'contact.assigned_to_staff',  group: 'Contact' },
  { id: 'c09',  name: 'Opportunity Source',   slug: 'contact.opportunity_source', group: 'Contact' },
  { id: 'c10',  name: 'Contact Type',         slug: 'contact.contact_type',       group: 'Contact' },
  { id: 'c11',  name: 'Business Name',        slug: 'contact.business_name',      group: 'Contact' },
  { id: 'c12',  name: 'Business GST No',      slug: 'contact.gst_no',             group: 'Contact' },
  { id: 'c13',  name: 'Business State',       slug: 'contact.state',              group: 'Contact' },
  { id: 'c14',  name: 'Business Address',     slug: 'contact.street_address',     group: 'Contact' },
  { id: 'c15',  name: 'Profile Photo',        slug: 'contact.profile_image',      group: 'Contact' },
  { id: 'c16',  name: 'Date of Birth',        slug: 'contact.date_of_birth',      group: 'Contact' },
  { id: 'c17',  name: 'Postal Code',          slug: 'contact.postal_code',        group: 'Contact' },
  { id: 'co1',  name: 'Company Name',         slug: 'company.name',               group: 'Company' },
  { id: 'co2',  name: 'Company Email',        slug: 'company.email',              group: 'Company' },
  { id: 'co3',  name: 'Company Phone',        slug: 'company.phone',              group: 'Company' },
  { id: 'co4',  name: 'Company Address',      slug: 'company.address',            group: 'Company' },
  { id: 'co5',  name: 'Company GST No.',      slug: 'company.gst_no',             group: 'Company' },
  { id: 'co6',  name: 'Company Logo',         slug: 'company.logo',               group: 'Company' },
  { id: 'co7',  name: 'Leader Name',          slug: 'company.leader_name',        group: 'Company' },
  { id: 'co8',  name: 'Leader Designation',   slug: 'company.leader_designation', group: 'Company' },
  { id: 'co9',  name: 'Leader Image',         slug: 'company.leader_image',       group: 'Company' },
  { id: 'cal1', name: 'Appointment Date',     slug: 'calendar.appointment_date',        group: 'Calendar' },
  { id: 'cal2', name: 'Appointment Start Time', slug: 'calendar.appointment_start_time', group: 'Calendar' },
  { id: 'cal3', name: 'Appointment End Time', slug: 'calendar.appointment_end_time',    group: 'Calendar' },
  { id: 'cal4', name: 'Appointment Timezone', slug: 'calendar.appointment_timezone',    group: 'Calendar' },
];

router.get('/system', (_req, res: Response) => {
  res.json(SYSTEM_FIELDS);
});

// ── Custom Standard Fields ────────────────────────────────────────────────────

router.get('/custom', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM custom_fields WHERE tenant_id=$1 ORDER BY created_at ASC',
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch (err: any) {
    if (err?.code === '42P01') { res.json([]); return; }
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/custom', checkPermission('fields:manage'), async (req: AuthRequest, res: Response) => {
  const { name, type, slug, placeholder, options, required, is_active } = req.body;
  if (!name || !type || !slug) { res.status(400).json({ error: 'name, type, slug required' }); return; }
  try {
    const result = await query(
      `INSERT INTO custom_fields (tenant_id, name, type, slug, placeholder, options, required, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user!.tenantId, name, type, slug, placeholder ?? null, options ? JSON.stringify(options) : null, required ?? false, is_active !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '42P01') { res.status(503).json({ error: 'custom_fields table not ready, run migrations' }); return; }
    if (err?.code === '23505') { res.status(409).json({ error: 'Slug already exists' }); return; }
    res.status(500).json({ error: err.message ?? 'Server error' });
  }
});

router.patch('/custom/:id', checkPermission('fields:manage'), async (req: AuthRequest, res: Response) => {
  const { name, type, placeholder, options, required, is_active } = req.body;
  const fields: string[] = [];
  const params: any[] = [];
  if (name !== undefined)        { params.push(name);       fields.push(`name=$${params.length}`); }
  if (type !== undefined)        { params.push(type);       fields.push(`type=$${params.length}`); }
  if (placeholder !== undefined) { params.push(placeholder); fields.push(`placeholder=$${params.length}`); }
  if (options !== undefined)     { params.push(JSON.stringify(options)); fields.push(`options=$${params.length}`); }
  if (required !== undefined)    { params.push(required);   fields.push(`required=$${params.length}`); }
  if (is_active !== undefined)   { params.push(is_active);  fields.push(`is_active=$${params.length}`); }
  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE custom_fields SET ${fields.join(',')} WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/custom/:id', checkPermission('fields:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM custom_fields WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user!.tenantId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Pipeline Questions ────────────────────────────────────────────────────────

router.get('/questions', async (req: AuthRequest, res: Response) => {
  const { pipeline_id } = req.query as { pipeline_id?: string };
  let sql = 'SELECT * FROM pipeline_questions WHERE tenant_id=$1';
  const params: any[] = [req.user!.tenantId];
  if (pipeline_id && pipeline_id !== 'all') {
    params.push(pipeline_id);
    sql += ` AND (pipeline_id=$${params.length} OR pipeline_id='all')`;
  }
  sql += ' ORDER BY sort_order ASC, created_at ASC';
  try {
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err: any) {
    if (err.code === '42P01') { res.json([]); return; } // table not yet created
    console.error('[fields GET /questions]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/questions', checkPermission('fields:manage'), async (req: AuthRequest, res: Response) => {
  const { pipeline_id, question, type, slug, options, required, sort_order } = req.body;
  if (!question || !type || !slug) { res.status(400).json({ error: 'question, type, slug required' }); return; }
  try {
    const result = await query(
      `INSERT INTO pipeline_questions (tenant_id, pipeline_id, question, type, slug, options, required, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user!.tenantId, pipeline_id ?? 'all', question, type, slug,
       options ? JSON.stringify(options) : null, required ?? false, sort_order ?? 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: 'Slug already exists' }); return; }
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/questions/:id', checkPermission('fields:manage'), async (req: AuthRequest, res: Response) => {
  const { question, type, options, required, sort_order } = req.body;
  const fields: string[] = [];
  const params: any[] = [];
  if (question !== undefined)   { params.push(question);   fields.push(`question=$${params.length}`); }
  if (type !== undefined)       { params.push(type);       fields.push(`type=$${params.length}`); }
  if (options !== undefined)    { params.push(JSON.stringify(options)); fields.push(`options=$${params.length}`); }
  if (required !== undefined)   { params.push(required);   fields.push(`required=$${params.length}`); }
  if (sort_order !== undefined) { params.push(sort_order); fields.push(`sort_order=$${params.length}`); }
  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE pipeline_questions SET ${fields.join(',')} WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/questions/:id', checkPermission('fields:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM pipeline_questions WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user!.tenantId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Value Tokens ──────────────────────────────────────────────────────────────

router.get('/values', checkPermission('fields:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM value_tokens WHERE tenant_id=$1 ORDER BY created_at ASC',
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/values', checkPermission('fields:manage'), async (req: AuthRequest, res: Response) => {
  const { name, replace_with } = req.body;
  if (!name || !replace_with) { res.status(400).json({ error: 'name and replace_with required' }); return; }
  try {
    const result = await query(
      'INSERT INTO value_tokens (tenant_id, name, replace_with) VALUES ($1,$2,$3) RETURNING *',
      [req.user!.tenantId, name, replace_with]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: 'Name already exists' }); return; }
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/values/:id', checkPermission('fields:manage'), async (req: AuthRequest, res: Response) => {
  const { name, replace_with } = req.body;
  const fields: string[] = [];
  const params: any[] = [];
  if (name !== undefined)         { params.push(name);        fields.push(`name=$${params.length}`); }
  if (replace_with !== undefined) { params.push(replace_with); fields.push(`replace_with=$${params.length}`); }
  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE value_tokens SET ${fields.join(',')} WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/values/:id', checkPermission('fields:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM value_tokens WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user!.tenantId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

export default router;
