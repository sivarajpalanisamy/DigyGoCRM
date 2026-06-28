import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission, hasPermission } from '../middleware/permissions';
import { checkUsage, incrementUsage, decrementUsage } from '../middleware/plan';
import { validate } from '../middleware/validate';
import { CreateLeadSchema, UpdateLeadSchema } from '../schemas/lead.schema';
import { normalizePhone, maskPhone } from '../utils/phone';
import { triggerWorkflows } from './workflows';
import { decrypt } from '../utils/crypto';
import { backfillCustomFields, cleanFieldKey } from '../utils/customFields';
import { cleanText } from '../utils/sanitize';
import { bumpTenantCacheVersion } from '../lib/cache';
import { parseMetaFieldData } from '../utils/meta';
import https from 'https';
import { emitToTenant } from '../socket';
import { sendNewLeadNotification, sendLeadAssignedNotification, sendBulkImportNotification } from '../utils/notifications';
import { pushLeadToSuperfone } from '../utils/superfone';
import { recordStageEntry } from '../utils/stageHistory';
import * as XLSX from 'xlsx';

const router = Router();
router.use(requireAuth);
router.use(requireTenant); // super_admin must use impersonation to access tenant data (#44)

// GET /api/leads
router.get('/', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const {
    stage, search, pipeline_id, assigned_to, source, source_ref, meta_form_id,
    tag, date_from, date_to,
    page = '1', limit = '200',
    after,          // cursor: ISO timestamp — when present, enables keyset pagination
  } = req.query as Record<string, string>;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Permission resolution: super_admin sees all; everyone else goes through
  // user_permissions. only_assigned is an absolute restriction — if ON it wins
  // over leads:view_all regardless of role. Fail-safe on DB errors (restrict).
  const isSuperAdmin = role === 'super_admin';
  let viewAll: boolean;

  if (isSuperAdmin) {
    viewAll = true;
  } else {
    // Owners always see all tenant data (they may have no user_permissions row,
    // in which case hasPermission would wrongly resolve view_all=false). Check
    // is_owner before falling back to the permission table.
    let isOwner = false;
    try { isOwner = (await query('SELECT is_owner FROM users WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)', [userId, tenantId])).rows[0]?.is_owner === true; } catch { isOwner = false; }

    if (isOwner) {
      viewAll = true;
    } else {
      let onlyAssigned = false;
      try { onlyAssigned = await hasPermission(userId, 'leads:only_assigned', tenantId); } catch { onlyAssigned = true; }

      if (onlyAssigned) {
        viewAll = false;
      } else {
        try { viewAll = await hasPermission(userId, 'leads:view_all', tenantId); } catch { viewAll = false; }
      }
    }
  }

  let shouldMaskPhone = false;
  if (!isSuperAdmin) {
    try { shouldMaskPhone = await hasPermission(userId, 'leads:mask_phone', tenantId); } catch {}
  }

  let sql = `
    SELECT l.*, ps.name AS stage_name, p.name AS pipeline_name,
           u.name AS assigned_name,
           mf.form_name AS meta_form_name,
           cf.name AS custom_form_name
    FROM leads l
    LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
    LEFT JOIN pipelines p ON p.id = l.pipeline_id
    LEFT JOIN users u ON u.id = l.assigned_to
    LEFT JOIN meta_forms mf ON mf.form_id = l.meta_form_id AND mf.tenant_id = l.tenant_id
    LEFT JOIN custom_forms cf ON cf.id::text = l.source_ref AND l.source = 'Custom Form'
    WHERE l.tenant_id = $1 AND l.is_deleted = FALSE
  `;
  const params: any[] = [tenantId];

  if (!viewAll) {
    params.push(userId);
    sql += ` AND (l.assigned_to = $${params.length}::uuid OR $${params.length}::uuid = ANY(l.team_members))`;
  }

  if (stage)       { params.push(stage);                  sql += ` AND l.stage_id = $${params.length}`; }
  if (pipeline_id) { params.push(pipeline_id);            sql += ` AND l.pipeline_id = $${params.length}`; }
  if (assigned_to === 'none') { sql += ` AND l.assigned_to IS NULL`; }
  else if (assigned_to) { params.push(assigned_to);            sql += ` AND l.assigned_to = $${params.length}`; }
  if (source)         { params.push(source);       sql += ` AND l.source = $${params.length}`; }
  if (source_ref)     { params.push(source_ref);   sql += ` AND l.source_ref = $${params.length}`; }
  if (meta_form_id)   { params.push(meta_form_id); sql += ` AND l.meta_form_id = $${params.length}`; }
  if (date_from)   { params.push(date_from);              sql += ` AND l.created_at >= $${params.length}`; }
  if (date_to)     { params.push(date_to);                sql += ` AND l.created_at <= $${params.length}`; }
  if (tag) {
    params.push(tag);
    sql += ` AND EXISTS (
      SELECT 1 FROM lead_tags lt
      JOIN tags tg ON tg.id = lt.tag_id
      WHERE lt.lead_id = l.id AND tg.name = $${params.length}
    )`;
  }
  if (search) {
    params.push(`%${search}%`);
    const phoneSearchClause = shouldMaskPhone ? '' : ` OR l.phone ILIKE $${params.length}`;
    sql += ` AND (l.name ILIKE $${params.length} OR l.email ILIKE $${params.length}${phoneSearchClause})`;
  }

  const pageSize = parseInt(limit);

  if (after !== undefined) {
    // Keyset / cursor pagination — after="" means first page. Cursor is
    // "<iso>|<id>" so leads sharing a created_at (bulk import) can't skip or
    // duplicate at a page boundary. (Legacy bare-timestamp cursors still work:
    // the id half is just absent.)
    if (after) {
      const [ts, id] = after.split('|');
      if (id) {
        params.push(ts, id);
        sql += ` AND (l.created_at, l.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
      } else {
        params.push(ts);
        sql += ` AND l.created_at < $${params.length}`;
      }
    }
    sql += ` ORDER BY l.created_at DESC, l.id DESC LIMIT $${params.length + 1}`;
    params.push(pageSize);
  } else {
    // Legacy offset pagination (used by initFromApi with limit=200)
    sql += ` ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(pageSize, offset);
  }

  try {
    const result = await query(sql, params);
    // Slim the payload: the list consumers (crmStore, LeadsPage) only read
    // custom_fields.lead_quality, so drop the rest of the (potentially large, post-import)
    // custom_fields JSONB from every row. Cuts the list response by a lot on big tenants.
    const rows = result.rows.map((r: any) => {
      const lq = r.custom_fields?.lead_quality ?? null;
      const slim = { ...r, custom_fields: lq ? { lead_quality: lq } : {} };
      return shouldMaskPhone ? { ...slim, phone: maskPhone(slim.phone) } : slim;
    });

    if (after !== undefined) {
      const last = rows[rows.length - 1];
      const nextCursor = rows.length === pageSize
        ? `${new Date(last.created_at).toISOString()}|${last.id}`
        : null;
      res.json({ leads: rows, nextCursor });
    } else {
      res.json(rows);
    }
  } catch (err: any) {
    // 42703 = undefined_column; most likely meta_form_id column not yet added by migration
    if (err.code === '42703') {
      res.json(after !== undefined ? { leads: [], nextCursor: null } : []);
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Resolve whether a user sees all tenant leads or only their assigned ones.
// Mirrors the inline block in GET '/' (super_admin → all; owner → all;
// only_assigned wins over view_all; fail-safe = restrict).
async function resolveViewAll(userId: string, tenantId: string | null, role: string): Promise<boolean> {
  if (role === 'super_admin') return true;
  let isOwner = false;
  try { isOwner = (await query('SELECT is_owner FROM users WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)', [userId, tenantId])).rows[0]?.is_owner === true; } catch { isOwner = false; }
  if (isOwner) return true;
  let onlyAssigned = false;
  try { onlyAssigned = await hasPermission(userId, 'leads:only_assigned', tenantId!); } catch { onlyAssigned = true; }
  if (onlyAssigned) return false;
  try { return await hasPermission(userId, 'leads:view_all', tenantId!); } catch { return false; }
}

// GET /api/leads/stage-counts?pipeline_id= — lead count per stage for the board,
// so the kanban can show counts without loading every lead. View-scoped.
router.get('/stage-counts', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const { pipeline_id } = req.query as Record<string, string>;
  try {
    const viewAll = await resolveViewAll(userId, tenantId, role);
    const params: any[] = [tenantId];
    let sql = `SELECT l.stage_id, COUNT(*)::int AS count
               FROM leads l
               WHERE l.tenant_id = $1 AND l.is_deleted = FALSE`;
    if (!viewAll) {
      params.push(userId);
      sql += ` AND (l.assigned_to = $${params.length}::uuid OR $${params.length}::uuid = ANY(l.team_members))`;
    }
    if (pipeline_id) { params.push(pipeline_id); sql += ` AND l.pipeline_id = $${params.length}`; }
    sql += ` GROUP BY l.stage_id`;
    const r = await query(sql, params);
    const counts: Record<string, number> = {};
    for (const row of r.rows) if (row.stage_id) counts[row.stage_id] = row.count;
    res.json({ counts });
  } catch (err: any) {
    console.error('[GET /leads/stage-counts]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/tags — all unique tags used across tenant leads (for workflow editor dropdown)
router.get('/tags', async (req: AuthRequest, res: Response) => {
  try {
    // tags is TEXT[] — use UNNEST, not jsonb_array_elements_text
    const result = await query(
      `SELECT DISTINCT tag
       FROM leads,
            UNNEST(tags) AS tag
       WHERE tenant_id = $1
         AND is_deleted = FALSE
         AND tags IS NOT NULL
         AND cardinality(tags) > 0
         AND tag IS NOT NULL
         AND tag <> ''
       ORDER BY tag`,
      [req.user!.tenantId]
    );
    res.json(result.rows.map((r: any) => r.tag as string));
  } catch (err: any) {
    console.error('[GET /leads/tags]', err.code, err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/followups — follow-ups scoped by user access level
router.get('/followups', checkPermission('followups:view'), async (req: AuthRequest, res: Response) => {
  const { userId, tenantId, role } = req.user!;
  try {
    const isSuperAdmin = role === 'super_admin';
    let onlyAssigned = false;

    if (!isSuperAdmin) {
      const ownerCheck = await query('SELECT is_owner FROM users WHERE id=$1 LIMIT 1', [userId]);
      const isOwner = ownerCheck.rows[0]?.is_owner === true;
      if (!isOwner) {
        try { onlyAssigned = await hasPermission(userId, 'leads:only_assigned', tenantId); } catch { onlyAssigned = true; }
        if (!onlyAssigned) {
          const viewAll = await hasPermission(userId, 'leads:view_all', tenantId).catch(() => false);
          onlyAssigned = !viewAll;
        }
      }
    }

    let sql = `
      SELECT f.*, l.name AS lead_name, l.phone AS lead_phone, u.name AS assigned_name
      FROM lead_followups f
      LEFT JOIN leads l ON l.id = f.lead_id
      LEFT JOIN users u ON u.id = f.assigned_to
      WHERE f.tenant_id = $1
        AND l.id IS NOT NULL AND l.is_deleted = FALSE
    `;
    const params: any[] = [tenantId];

    if (onlyAssigned) {
      params.push(userId);
      sql += ` AND (f.assigned_to = $${params.length}::uuid OR l.assigned_to = $${params.length}::uuid OR $${params.length}::uuid = ANY(l.team_members))`;
    }

    sql += ' ORDER BY f.due_at ASC';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/export
const LEAD_FIELDS: Record<string, string> = {
  name: 'Name', email: 'Email', phone: 'Phone', company: 'Company',
  source: 'Source', status: 'Lead Status',
  quality: 'Quality', pipeline_name: 'Pipeline', stage_name: 'Stage',
  assigned_name: 'Assigned To', tags: 'Tags', created_at: 'Created At',
  deal_value: 'Deal Value', notes: 'Notes', lead_updated_at: 'Last Updated',
  next_followup_date: 'Next Follow-up Date', followup_status: 'Follow-up Status',
  team_member_names: 'Team Members',
};

const LEAD_SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual', meta_form: 'Meta Form', custom_form: 'Custom Form',
  calendar_booking: 'Calendar Booking', whatsapp: 'WhatsApp', api: 'API',
  import: 'Import', landing_page: 'Landing Page', referral: 'Referral',
  website: 'Website', phone_call: 'Phone Call', email: 'Email',
  social_media: 'Social Media', paid_ad: 'Paid Ad', event: 'Event',
};

const LEAD_QUALITY_LABELS: Record<string, string> = {
  hot: 'Hot', warm: 'Warm', cold: 'Cold', unqualified: 'Unqualified',
};

const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'New', active: 'Active', contacted: 'Contacted',
  qualified: 'Qualified', converted: 'Converted', lost: 'Lost',
};

router.get('/export', checkPermission('leads:export'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const { fields = '', format = 'xlsx', pipeline_id, stage, search, assigned_to } = req.query as Record<string, string>;

  const isSuperAdmin = role === 'super_admin';
  let viewAll: boolean;
  let shouldMaskPhone = false;

  if (isSuperAdmin) {
    viewAll = true;
  } else {
    let onlyAssigned = false;
    try { onlyAssigned = await hasPermission(userId, 'leads:only_assigned', tenantId); } catch { onlyAssigned = true; }
    if (onlyAssigned) {
      viewAll = false;
    } else {
      try { viewAll = await hasPermission(userId, 'leads:view_all', tenantId); } catch { viewAll = false; }
    }
    try { shouldMaskPhone = await hasPermission(userId, 'leads:mask_phone', tenantId); } catch {}
  }

  let sql = `
    SELECT l.*,
           ps.name AS stage_name,
           p.name AS pipeline_name,
           u.name AS assigned_name,
           l.custom_fields->>'lead_quality' AS quality,
           l.updated_at AS lead_updated_at,
           (SELECT c.company FROM contacts c WHERE c.lead_id = l.id LIMIT 1) AS company,
           (SELECT string_agg(u2.name, ', ') FROM users u2 WHERE u2.id = ANY(l.team_members)) AS team_member_names,
           (SELECT MIN(f.due_at) FROM lead_followups f WHERE f.lead_id = l.id AND f.completed = FALSE) AS next_followup_date,
           (SELECT CASE
              WHEN MIN(f.due_at) IS NULL THEN 'None'
              WHEN MIN(f.due_at) < NOW() THEN 'Overdue'
              ELSE 'Pending'
            END FROM lead_followups f WHERE f.lead_id = l.id AND f.completed = FALSE) AS followup_status,
           (SELECT string_agg(
              '[' || TO_CHAR(n.created_at, 'DD-Mon-YYYY HH12:MI AM') || '] ' ||
              COALESCE(un.name, 'System') || ': ' ||
              COALESCE(NULLIF(TRIM(n.title), '') || ' - ', '') || COALESCE(n.content, ''),
              E'\n' ORDER BY n.created_at ASC
            ) FROM lead_notes n LEFT JOIN users un ON un.id = n.created_by WHERE n.lead_id = l.id) AS notes
    FROM leads l
    LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
    LEFT JOIN pipelines p ON p.id = l.pipeline_id
    LEFT JOIN users u ON u.id = l.assigned_to
    WHERE l.tenant_id = $1 AND l.is_deleted = FALSE
  `;
  const params: any[] = [tenantId];

  if (!viewAll) { params.push(userId); sql += ` AND l.assigned_to = $${params.length}`; }
  if (pipeline_id) { params.push(pipeline_id); sql += ` AND l.pipeline_id = $${params.length}`; }
  if (stage)       { params.push(stage);       sql += ` AND l.stage_id = $${params.length}`; }
  if (assigned_to === 'none') { sql += ` AND l.assigned_to IS NULL`; }
  else if (assigned_to) { params.push(assigned_to); sql += ` AND l.assigned_to = $${params.length}`; }
  if (search) {
    params.push(`%${search}%`);
    const phoneClause = shouldMaskPhone ? '' : ` OR l.phone ILIKE $${params.length}`;
    sql += ` AND (l.name ILIKE $${params.length} OR l.email ILIKE $${params.length}${phoneClause})`;
  }
  sql += ' ORDER BY l.created_at DESC LIMIT 10000';

  try {
    const result = await query(sql, params);
    const rows = result.rows;

    const selectedFields = fields ? fields.split(',').filter((f) => LEAD_FIELDS[f]) : Object.keys(LEAD_FIELDS);

    const sheetData = rows.map((row: any) => {
      const out: Record<string, any> = {};
      for (const f of selectedFields) {
        let val = row[f];
        if (f === 'phone' && shouldMaskPhone) val = maskPhone(val);
        if (f === 'tags' && Array.isArray(val)) val = val.join(', ');
        if ((f === 'created_at' || f === 'lead_updated_at') && val) val = new Date(val).toLocaleString();
        if (f === 'next_followup_date' && val) val = new Date(val).toLocaleString();
        if (f === 'deal_value' && val !== null && val !== undefined) val = Number(val);
        if (f === 'source' && val)
          val = LEAD_SOURCE_LABELS[val] ?? val.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        if (f === 'quality' && val)
          val = LEAD_QUALITY_LABELS[val] ?? val;
        if (f === 'status' && val)
          val = LEAD_STATUS_LABELS[val] ?? val;
        out[LEAD_FIELDS[f]] = (val !== null && val !== undefined && val !== '') ? val : 'No data';
      }
      return out;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');

    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
      res.setHeader('Content-Type', 'text/csv');
      res.send(csv);
    } else {
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', 'attachment; filename="leads.xlsx"');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buf);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// GET /api/leads/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const { userId, tenantId, role } = req.user!;
  try {
    const result = await query(
      `SELECT l.*, ps.name AS stage_name, p.name AS pipeline_name, u.name AS assigned_name,
              mf.form_name AS meta_form_name,
              cf.name AS custom_form_name
       FROM leads l
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       LEFT JOIN pipelines p ON p.id = l.pipeline_id
       LEFT JOIN users u ON u.id = l.assigned_to
       LEFT JOIN meta_forms mf ON mf.form_id = l.meta_form_id AND mf.tenant_id = l.tenant_id
       LEFT JOIN custom_forms cf ON cf.id::text = l.source_ref AND l.source = 'Custom Form'
       WHERE l.id = $1 AND l.tenant_id = $2 AND l.is_deleted = FALSE`,
      [req.params.id, tenantId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Lead not found' }); return; }
    let lead = result.rows[0];
    if (role !== 'super_admin') {
      let shouldMask = false;
      try { shouldMask = await hasPermission(userId, 'leads:mask_phone', tenantId); } catch {}
      if (shouldMask) lead = { ...lead, phone: maskPhone(lead.phone) };
    }
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads
router.post('/', checkPermission('leads:create'), checkUsage('leads'), validate(CreateLeadSchema), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const { email, pipeline_id, stage_id, tags } = req.body;
  const name = cleanText(req.body.name);
  const notes = req.body.notes !== undefined ? cleanText(req.body.notes) : req.body.notes;
  const source: string = 'Manual';
  const phone = req.body.phone ? normalizePhone(req.body.phone) : req.body.phone;

  // `|| null` (not `?? null`) so an empty-string assignee from the form becomes
  // NULL rather than being inserted into a UUID column.
  const explicitAssignee = (req.body.assigned_to as string | null) || null;

  try {
    // Validate assigned_to belongs to the same tenant (#51)
    if (explicitAssignee) {
      const userCheck = await query(
        `SELECT id FROM users WHERE id=$1 AND tenant_id=$2 AND is_active=TRUE`,
        [explicitAssignee, tenantId]
      );
      if (!userCheck.rows[0]) {
        res.status(400).json({ error: 'assigned_to user not found in your organization' }); return;
      }
    }

    // Auto-assign the new lead to its creator when no assignee was chosen AND the
    // creator cannot view all leads. Without this, a restricted (only_assigned /
    // no view_all) staff member's own lead is saved unassigned and immediately
    // disappears from their list, while admins still see it. Mirrors the viewAll
    // resolution used by GET /api/leads. Owners/super_admin/view-all staff keep the
    // ability to deliberately create unassigned leads.
    let assignee = explicitAssignee;
    if (!assignee) {
      let creatorViewAll = false;
      if (role === 'super_admin') {
        creatorViewAll = true;
      } else {
        const isOwner = (await query('SELECT is_owner FROM users WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)', [userId, tenantId])).rows[0]?.is_owner === true;
        if (isOwner) {
          creatorViewAll = true;
        } else {
          const onlyAssigned = await hasPermission(userId, 'leads:only_assigned', tenantId).catch(() => true);
          creatorViewAll = onlyAssigned ? false : await hasPermission(userId, 'leads:view_all', tenantId).catch(() => false);
        }
      }
      if (!creatorViewAll) assignee = userId;
    }

    // Phone uniqueness check
    if (phone) {
      const dupPhone = await query(
        `SELECT id, name FROM leads WHERE tenant_id=$1 AND phone=$2 AND is_deleted=FALSE LIMIT 1`,
        [tenantId, phone]
      );
      if (dupPhone.rows[0]) {
        res.status(409).json({ error: `Phone number already exists - lead "${dupPhone.rows[0].name}" has this number`, duplicate_lead_id: dupPhone.rows[0].id });
        return;
      }
    }
    // Email uniqueness check
    if (email) {
      const dupEmail = await query(
        `SELECT id, name FROM leads WHERE tenant_id=$1 AND LOWER(email)=LOWER($2) AND is_deleted=FALSE LIMIT 1`,
        [tenantId, email]
      );
      if (dupEmail.rows[0]) {
        res.status(409).json({ error: `Email already exists - lead "${dupEmail.rows[0].name}" has this email`, duplicate_lead_id: dupEmail.rows[0].id });
        return;
      }
    }

    const teamMembers: string[] = Array.isArray(req.body.team_members) ? req.body.team_members : [];
    const result = await query(
      `INSERT INTO leads (tenant_id, name, email, phone, source, pipeline_id, stage_id, assigned_to, notes, tags, team_members)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid[]) RETURNING *`,
      [tenantId, name, email, phone, source, pipeline_id, stage_id, assignee, notes, tags ?? [], teamMembers.length > 0 ? teamMembers : null]
    );
    let lead = result.rows[0];

    // Stage timeline: record the initial stage entry
    if (lead?.stage_id) setImmediate(() => recordStageEntry(lead.id, tenantId!, lead.stage_id, lead.pipeline_id).catch(() => null));

    // Set custom_fields (e.g. lead_quality) if provided at creation time
    if (req.body.custom_fields && typeof req.body.custom_fields === 'object') {
      const cfResult = await query(
        `UPDATE leads SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $1::jsonb WHERE id=$2 RETURNING *`,
        [JSON.stringify(req.body.custom_fields), lead.id]
      );
      if (cfResult.rows[0]) lead = cfResult.rows[0];
    }

    await query(
      `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
       VALUES ($1,$2,'created','Lead created',$3)`,
      [lead.id, tenantId, userId]
    );
    const leadWithName = await query(
      `SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id = $1`,
      [lead.id]
    );
    const emitLead = leadWithName.rows[0] ?? lead;
    emitToTenant(tenantId!, 'lead:created', emitLead);
    bumpTenantCacheVersion(tenantId!).catch(() => {}); // refresh dashboards/reports
    res.status(201).json(emitLead);
    setImmediate(async () => {
      incrementUsage(tenantId!, 'leads').catch(() => null);
      triggerWorkflows('lead_created', lead, tenantId!, userId).catch(() => null);

      sendNewLeadNotification(tenantId!, lead, userId).catch((err) =>
        console.error('Failed to create lead notifications:', err)
      );
      pushLeadToSuperfone(tenantId!, lead).catch(() => null);
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/leads/:id
router.patch('/:id', checkPermission('leads:edit'), validate(UpdateLeadSchema), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  if (req.body.phone) req.body.phone = normalizePhone(req.body.phone);

  // Reassigning a lead is a privileged action gated by leads:assign. Without it, a
  // staff cannot hand off or drop a lead given to them (incl. unassigning THEMSELVES) —
  // only the change to assigned_to is ignored; the rest of their edit still saves.
  if (req.body.assigned_to !== undefined) {
    const cur = await query('SELECT assigned_to FROM leads WHERE id=$1 AND tenant_id=$2', [req.params.id, tenantId]);
    const curAssigned = cur.rows[0]?.assigned_to ?? null;
    const newAssigned = req.body.assigned_to || null;
    if (String(curAssigned ?? '') !== String(newAssigned ?? '')) {
      let canAssign = role === 'super_admin';
      if (!canAssign) {
        const owner = await query('SELECT is_owner FROM users WHERE id=$1', [userId]);
        canAssign = owner.rows[0]?.is_owner === true
          || await hasPermission(userId, 'leads:assign', tenantId).catch(() => false);
      }
      if (!canAssign) delete req.body.assigned_to;
    }
  }

  const allowed = ['name', 'email', 'phone', 'pipeline_id', 'stage_id', 'assigned_to', 'notes', 'tags', 'status', 'deal_value'];
  const updates: string[] = [];
  const params: any[] = [];

  const TEXT_FIELDS = new Set(['name', 'notes']); // free-text → XSS-sanitize
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      params.push(TEXT_FIELDS.has(field) ? cleanText(req.body[field]) : req.body[field]);
      updates.push(`${field} = $${params.length}`);
    }
  }

  // Merge custom_fields patch (e.g. { lead_quality: 'Hot' }) into JSONB column
  if (req.body.custom_fields && typeof req.body.custom_fields === 'object') {
    params.push(JSON.stringify(req.body.custom_fields));
    updates.push(`custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $${params.length}::jsonb`);
  }

  // Team members — replace the full array
  if (req.body.team_members !== undefined) {
    const members: string[] = Array.isArray(req.body.team_members) ? req.body.team_members : [];
    params.push(members);
    updates.push(`team_members = $${params.length}::uuid[]`);
  }

  if (!updates.length) { res.status(400).json({ error: 'No fields to update' }); return; }

  updates.push(`updated_at = NOW()`);
  params.push(req.params.id, tenantId);

  try {
    // Phone uniqueness check (exclude current lead)
    if (req.body.phone) {
      const normPhone = normalizePhone(req.body.phone);
      const dupPhone = await query(
        `SELECT id, name FROM leads WHERE tenant_id=$1 AND phone=$2 AND is_deleted=FALSE AND id<>$3 LIMIT 1`,
        [tenantId, normPhone, req.params.id]
      );
      if (dupPhone.rows[0]) {
        res.status(409).json({ error: `Phone number already in use by "${dupPhone.rows[0].name}"`, duplicate_lead_id: dupPhone.rows[0].id });
        return;
      }
    }
    // Email uniqueness check (exclude current lead)
    if (req.body.email) {
      const dupEmail = await query(
        `SELECT id, name FROM leads WHERE tenant_id=$1 AND LOWER(email)=LOWER($2) AND is_deleted=FALSE AND id<>$3 LIMIT 1`,
        [tenantId, req.body.email, req.params.id]
      );
      if (dupEmail.rows[0]) {
        res.status(409).json({ error: `Email already in use by "${dupEmail.rows[0].name}"`, duplicate_lead_id: dupEmail.rows[0].id });
        return;
      }
    }

    // Validate assigned_to belongs to the same tenant before writing (#51)
    if (req.body.assigned_to) {
      const userCheck = await query(
        `SELECT id FROM users WHERE id=$1 AND tenant_id=$2 AND is_active=TRUE`,
        [req.body.assigned_to, tenantId]
      );
      if (!userCheck.rows[0]) {
        res.status(400).json({ error: 'assigned_to user not found in your organization' }); return;
      }
    }

    // Get current lead for activity logging
    const current = await query('SELECT stage_id, assigned_to, tags, pipeline_id FROM leads WHERE id=$1 AND tenant_id=$2', [req.params.id, tenantId]);
    const old = current.rows[0];

    const result = await query(
      `UPDATE leads SET ${updates.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length} AND is_deleted = FALSE RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Lead not found' }); return; }

    // Log stage change activity and fire workflow
    if (old && req.body.stage_id && req.body.stage_id !== old.stage_id) {
      const stageRes = await query('SELECT name FROM pipeline_stages WHERE id=$1', [req.body.stage_id]);
      const stageName = stageRes.rows[0]?.name ?? 'Unknown';
      await query(
        `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
         VALUES ($1,$2,'stage_change',$3,$4)`,
        [req.params.id, tenantId, `Stage changed to ${stageName}`, userId]
      );
      setImmediate(() => recordStageEntry(req.params.id, tenantId!, req.body.stage_id, result.rows[0]?.pipeline_id).catch(() => null));
      setImmediate(() => triggerWorkflows('stage_changed', { ...result.rows[0], stage_name: stageName }, tenantId!, userId).catch(() => null));
    }

    // Fire lead_created when a lead is added to a pipeline (new assignment or moved from another pipeline)
    if (old && result.rows[0].pipeline_id && old.pipeline_id !== result.rows[0].pipeline_id) {
      setImmediate(() => triggerWorkflows('lead_created', result.rows[0], tenantId!, userId).catch(() => null));
    }

    // Log tag changes and fire contact_tagged workflow trigger
    if (old && req.body.tags !== undefined) {
      const oldTags: string[] = old.tags ?? [];
      const newTags: string[] = req.body.tags ?? [];
      const added = newTags.filter((t: string) => !oldTags.includes(t));
      const removed = oldTags.filter((t: string) => !newTags.includes(t));
      if (added.length > 0) {
        await query(
          `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
           VALUES ($1,$2,'tag_added',$3,$4)`,
          [req.params.id, tenantId, `Tags added: ${added.join(', ')}`, userId]
        );
        // Fire one contact_tagged trigger per newly added tag
        const lead = result.rows[0];
        for (const addedTag of added) {
          setImmediate(() => triggerWorkflows('contact_tagged', lead, tenantId!, userId,
            { triggerContext: { tag: addedTag } }
          ).catch(() => null));
        }
      }
      if (removed.length > 0) {
        await query(
          `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
           VALUES ($1,$2,'tag_removed',$3,$4)`,
          [req.params.id, tenantId, `Tags removed: ${removed.join(', ')}`, userId]
        );
      }
    }

    const withName = await query(
      `SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id = $1`,
      [result.rows[0].id]
    );
    const emitPayload = withName.rows[0] ?? result.rows[0];

    // Fix 6: notify newly assigned staff when assigned_to changes
    if (old && req.body.assigned_to && req.body.assigned_to !== old.assigned_to) {
      sendLeadAssignedNotification(
        tenantId!,
        { id: result.rows[0].id, name: result.rows[0].name },
        req.body.assigned_to,
        userId,
      ).catch(() => null);
    }

    emitToTenant(tenantId!, 'lead:updated', emitPayload);
    bumpTenantCacheVersion(tenantId!).catch(() => {}); // refresh dashboards/reports
    res.json(emitPayload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/leads/:id — soft delete only
router.delete('/:id', checkPermission('leads:delete'), async (req: AuthRequest, res: Response) => {
  try {
    await query(
      'UPDATE leads SET is_deleted = TRUE WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user!.tenantId]
    );
    bumpTenantCacheVersion(req.user!.tenantId!).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Notes ─────────────────────────────────────────────────────────────────────

// GET /api/leads/:id/notes
router.get('/:id/notes', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT n.*, u.name AS created_by_name
       FROM lead_notes n
       LEFT JOIN users u ON u.id = n.created_by
       WHERE n.lead_id = $1 AND n.tenant_id = $2
       ORDER BY n.created_at DESC`,
      [req.params.id, req.user!.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads/:id/notes
router.post('/:id/notes', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const title = cleanText(req.body.title);
  const content = cleanText(req.body.content);
  if (!content) { res.status(400).json({ error: 'Content is required' }); return; }
  try {
    const result = await query(
      `INSERT INTO lead_notes (lead_id, tenant_id, title, content, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, tenantId, title, content, userId]
    );
    await query(
      `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
       VALUES ($1,$2,'note',$3,$4)`,
      [req.params.id, tenantId, `Note added: ${title ?? content.slice(0, 40)}`, userId]
    );
    res.status(201).json(result.rows[0]);
    setImmediate(() => triggerWorkflows('notes_added', { id: req.params.id, name: '' }, tenantId!, userId).catch(() => null));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/leads/:id/notes/:noteId — edit a note's title/content
router.patch('/:id/notes/:noteId', async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { title, content } = req.body;
  if (content !== undefined && !String(content).trim()) { res.status(400).json({ error: 'Content cannot be empty' }); return; }
  const updates: string[] = []; const params: any[] = [];
  if (title !== undefined)   { params.push(cleanText(title));   updates.push(`title=$${params.length}`); }
  if (content !== undefined) { params.push(cleanText(content)); updates.push(`content=$${params.length}`); }
  if (!updates.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  params.push(req.params.noteId, req.params.id, tenantId);
  try {
    const r = await query(
      `UPDATE lead_notes SET ${updates.join(',')} WHERE id=$${params.length - 2} AND lead_id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!r.rows[0]) { res.status(404).json({ error: 'Note not found' }); return; }
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/leads/:id/notes/:noteId
router.delete('/:id/notes/:noteId', async (req: AuthRequest, res: Response) => {
  try {
    await query(
      'DELETE FROM lead_notes WHERE id=$1 AND lead_id=$2 AND tenant_id=$3',
      [req.params.noteId, req.params.id, req.user!.tenantId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Follow-ups ─────────────────────────────────────────────────────────────────

// GET /api/leads/:id/followups
router.get('/:id/followups', checkPermission('followups:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT f.*, u.name AS assigned_name
       FROM lead_followups f
       LEFT JOIN users u ON u.id = f.assigned_to
       WHERE f.lead_id = $1 AND f.tenant_id = $2
       ORDER BY f.due_at ASC`,
      [req.params.id, req.user!.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads/:id/followups
router.post('/:id/followups', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const { due_at, assigned_to, type: followupType } = req.body;
  const title = cleanText(req.body.title);
  const description = cleanText(req.body.description);
  if (!title || !due_at) { res.status(400).json({ error: 'Title and due_at are required' }); return; }
  try {
    const result = await query(
      `INSERT INTO lead_followups (lead_id, tenant_id, title, description, due_at, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, tenantId, title, description, due_at, assigned_to ?? userId, userId]
    );
    await query(
      `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
       VALUES ($1,$2,'followup',$3,$4)`,
      [req.params.id, tenantId, `Follow-up scheduled: ${title}`, userId]
    );
    res.status(201).json(result.rows[0]);
    setImmediate(() => triggerWorkflows('follow_up', { id: req.params.id, name: '' }, tenantId!, userId,
      { triggerContext: { followupType: followupType ?? '', assignedTo: assigned_to ?? userId } }
    ).catch(() => null));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/leads/:id/followups/:fuId — edit (title/description/due_at) and/or mark complete
router.patch('/:id/followups/:fuId', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const { title, description, due_at, completed } = req.body;
  const updates: string[] = []; const params: any[] = [];
  if (title !== undefined)       { params.push(cleanText(title));       updates.push(`title=$${params.length}`); }
  if (description !== undefined) { params.push(cleanText(description)); updates.push(`description=$${params.length}`); }
  if (due_at !== undefined)      { params.push(due_at);      updates.push(`due_at=$${params.length}`); }
  if (completed !== undefined) {
    params.push(completed); updates.push(`completed=$${params.length}`);
    params.push(completed ? new Date().toISOString() : null); updates.push(`completed_at=$${params.length}`);
  }
  if (!updates.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  params.push(req.params.fuId, req.params.id, tenantId);
  try {
    const result = await query(
      `UPDATE lead_followups SET ${updates.join(',')}
       WHERE id=$${params.length - 2} AND lead_id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Follow-up not found' }); return; }
    if (completed === true) {
      await query(
        `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
         VALUES ($1,$2,'followup',$3,$4)`,
        [req.params.id, tenantId, `Follow-up completed: ${result.rows[0].title}`, userId]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/leads/:id/followups/:fuId
router.delete('/:id/followups/:fuId', async (req: AuthRequest, res: Response) => {
  try {
    await query(
      'DELETE FROM lead_followups WHERE id=$1 AND lead_id=$2 AND tenant_id=$3',
      [req.params.fuId, req.params.id, req.user!.tenantId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Activities ─────────────────────────────────────────────────────────────────

// GET /api/leads/:id/activities
router.get('/:id/activities', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT a.*, u.name AS created_by_name,
              CASE WHEN a.type = 'call' AND a.detail IS NOT NULL
                   THEN (SELECT CASE WHEN cl.recording_path IS NOT NULL OR cl.recording_url IS NOT NULL THEN TRUE ELSE FALSE END
                         FROM call_logs cl WHERE cl.id::text = a.detail LIMIT 1)
                   ELSE NULL END AS has_recording
       FROM lead_activities a
       LEFT JOIN users u ON u.id = a.created_by
       WHERE a.lead_id = $1 AND a.tenant_id = $2
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [req.params.id, req.user!.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/:id/stage-history — ordered stage entries + per-stage duration (manager view)
router.get('/:id/stage-history', async (req: AuthRequest, res: Response) => {
  try {
    const rows = (await query(
      `SELECT stage_id, stage_name, entered_at FROM lead_stage_history
       WHERE lead_id=$1 AND tenant_id=$2 ORDER BY entered_at ASC`,
      [req.params.id, req.user!.tenantId]
    )).rows;
    const lead = (await query(
      `SELECT created_at FROM leads WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, req.user!.tenantId]
    )).rows[0];
    const now = Date.now();
    const history = rows.map((r: any, i: number) => {
      const start = new Date(r.entered_at).getTime();
      const end = i < rows.length - 1 ? new Date(rows[i + 1].entered_at).getTime() : now;
      return {
        stage_id: r.stage_id,
        stage_name: r.stage_name,
        entered_at: r.entered_at,
        duration_ms: Math.max(0, end - start),
        is_current: i === rows.length - 1,
      };
    });
    res.json({ created_at: lead?.created_at ?? null, history });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Per-lead custom field values ───────────────────────────────────────────────

// Internal keys kept in leads.custom_fields JSONB that must NOT surface as "Additional Fields"
const RESERVED_FIELD_KEYS = new Set(['lead_quality', 'ai_agent_id', '_selens']);
const prettifySlug = (slug: string) =>
  slug.split(/[_\-]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// GET /api/leads/:id/fields
router.get('/:id/fields', async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const leadId = req.params.id;

  // READ-ONLY: opening a lead must never depend on slow/flaky writes (backfill) or
  // Facebook's Graph API — those made the Additional Fields panel intermittently show
  // "no data" (a transient failure was swallowed into an empty list). We now serve the
  // defined field values and merge the lead's custom_fields JSONB straight through for
  // display, with each query guarded so a hiccup degrades gracefully instead of blanking
  // the panel. No INSERTs, no external calls, deterministic every open.
  let rows: any[] = [];
  try {
    rows = (await query(
      `SELECT lfv.*, cf.name AS field_name, cf.type AS field_type, cf.slug
       FROM lead_field_values lfv
       JOIN custom_fields cf ON cf.id = lfv.field_id
       WHERE lfv.lead_id = $1 AND lfv.tenant_id = $2`,
      [leadId, tenantId]
    )).rows;
  } catch (e) {
    // A transient failure here must NOT be swallowed into an empty 200 — that made the
    // panel show "no fields" (a false empty) and defeated the client retry. Surface it.
    console.error('[GET /:id/fields lfv]', e);
    res.status(500).json({ error: 'Failed to load field values' });
    return;
  }

  const finalRows = rows.filter((r: any) => !RESERVED_FIELD_KEYS.has(r.slug));

  // Merge display-only values from leads.custom_fields JSONB (imports, API trigger,
  // form submissions) for any slug not already present as a defined field. No writes.
  try {
    const leadRow = await query(`SELECT custom_fields FROM leads WHERE id=$1 AND tenant_id=$2`, [leadId, tenantId]);
    const jsonb: Record<string, any> = leadRow.rows[0]?.custom_fields ?? {};
    const present = new Set(finalRows.map((r: any) => r.slug));
    for (const [rawKey, val] of Object.entries(jsonb)) {
      if (val === null || val === undefined || val === '') continue;
      const slug = cleanFieldKey(rawKey);
      if (!slug || RESERVED_FIELD_KEYS.has(slug) || present.has(slug)) continue;
      finalRows.push({ field_name: prettifySlug(slug), slug, value: String(val), field_id: null });
      present.add(slug);
    }
  } catch (e) {
    console.error('[GET /:id/fields jsonb merge]', e);
  }

  res.json(finalRows);
});

function metaGraphGet(path: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `https://graph.facebook.com/v21.0${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from Meta API')); }
      });
    }).on('error', reject);
  });
}


// PATCH /api/leads/:id/fields — upsert one or many field values
router.patch('/:id/fields', async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const values: Array<{ field_id: string; value: string }> = req.body.values ?? [];
  if (!values.length) { res.status(400).json({ error: 'values array required' }); return; }
  try {
    for (const { field_id, value } of values) {
      await query(
        `INSERT INTO lead_field_values (lead_id, tenant_id, field_id, value)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (lead_id, field_id) DO UPDATE SET value=$4, updated_at=NOW()`,
        [req.params.id, tenantId, field_id, value]
      );
    }
    const result = await query(
      `SELECT lfv.*, cf.name AS field_name, cf.type AS field_type, cf.slug
       FROM lead_field_values lfv
       JOIN custom_fields cf ON cf.id = lfv.field_id
       WHERE lfv.lead_id = $1 AND lfv.tenant_id = $2`,
      [req.params.id, tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── CSV Export ─────────────────────────────────────────────────────────────────

// GET /api/leads/export
// Leak 8 fix: include all custom field values as additional columns.
router.get('/export', checkPermission('leads:view_all'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  let shouldMaskPhone = false;
  if (role !== 'super_admin') {
    try { shouldMaskPhone = await hasPermission(userId, 'leads:mask_phone', tenantId); } catch {}
  }
  try {
    // Fetch tenant's custom field definitions for column headers
    const cfDefs = await query(
      `SELECT slug, name FROM custom_fields WHERE tenant_id=$1 ORDER BY name`,
      [tenantId]
    );
    const customSlugs: string[]  = cfDefs.rows.map((r: any) => r.slug);
    const customNames: string[]  = cfDefs.rows.map((r: any) => r.name);

    const result = await query(
      `SELECT l.id, l.name, l.email, l.phone, l.source, l.status,
              ps.name AS stage, p.name AS pipeline,
              u.name AS assigned_to,
              l.tags, l.notes, l.created_at
       FROM leads l
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       LEFT JOIN pipelines p ON p.id = l.pipeline_id
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.tenant_id = $1 AND l.is_deleted = FALSE
       ORDER BY l.created_at DESC`,
      [tenantId]
    );

    // Bulk-fetch custom field values for all lead IDs
    const leadIds = result.rows.map((r: any) => r.id);
    const cfValMap: Record<string, Record<string, string>> = {};
    if (leadIds.length > 0 && customSlugs.length > 0) {
      const cfVals = await query(
        `SELECT lfv.lead_id, cf.slug, lfv.value
         FROM lead_field_values lfv
         JOIN custom_fields cf ON cf.id = lfv.field_id
         WHERE lfv.lead_id = ANY($1::uuid[]) AND lfv.tenant_id = $2`,
        [leadIds, tenantId]
      );
      for (const row of cfVals.rows) {
        if (!cfValMap[row.lead_id]) cfValMap[row.lead_id] = {};
        cfValMap[row.lead_id][row.slug] = row.value;
      }
    }

    const stdHeaders = ['name','email','phone','source','status','stage','pipeline','assigned_to','tags','notes','created_at'];
    const headers = [...stdHeaders, ...customNames];

    const escape = (v: unknown) => {
      const s = v == null ? '' : Array.isArray(v) ? v.join(';') : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s;
    };

    const csv = [
      headers.join(','),
      ...result.rows.map((r: any) => {
        const row = shouldMaskPhone ? { ...r, phone: maskPhone(r.phone) } : r;
        const stdCols = stdHeaders.map(h => escape(row[h]));
        const customCols = customSlugs.map(slug => escape(cfValMap[r.id]?.[slug] ?? ''));
        return [...stdCols, ...customCols].join(',');
      }),
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Import Template ────────────────────────────────────────────────────────────

// GET /api/leads/import-template
router.get('/import-template', checkPermission('leads:create'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.user!;
    const cfResult = await query(
      'SELECT name, slug FROM custom_fields WHERE tenant_id=$1 ORDER BY created_at ASC',
      [tenantId]
    );
    const customFields = cfResult.rows as Array<{ name: string; slug: string }>;

    const standardHeaders = ['Name', 'Phone', 'Email', 'Source', 'Deal Value', 'Tags', 'Notes', 'Stage'];
    const allHeaders = [...standardHeaders, ...customFields.map((cf) => cf.name)];
    const sampleRow = [
      'John Doe', '+919876543210', 'john@example.com', 'Manual', '50000',
      'Hot Lead', 'Called twice - very interested', 'New Lead',
      ...customFields.map(() => ''),
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([allHeaders, sampleRow]);
    ws['!cols'] = allHeaders.map((h) => ({ wch: Math.max(h.length + 4, 16) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Leads Import');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="leads_import_template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

// ── Import ─────────────────────────────────────────────────────────────────────

// POST /api/leads/import
router.post('/import', checkPermission('leads:create'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const {
    rows,
    pipeline_id,
    stage_id,
    duplicate_handling = 'skip',
  } = req.body as {
    rows: Array<Record<string, string>>;
    pipeline_id?: string;
    stage_id?: string;
    duplicate_handling?: 'skip' | 'update' | 'create';
  };

  if (!Array.isArray(rows) || !rows.length) {
    res.status(400).json({ error: 'rows array required' }); return;
  }

  // Load custom fields for slug → id lookup
  const cfResult = await query(
    'SELECT id, slug FROM custom_fields WHERE tenant_id=$1',
    [tenantId]
  );
  const cfMap: Record<string, string> = {};
  cfResult.rows.forEach((r: any) => { cfMap[r.slug] = r.id; });

  // Load stages by name for the chosen pipeline
  const stagesResult = pipeline_id
    ? await query('SELECT id, name FROM pipeline_stages WHERE pipeline_id=$1', [pipeline_id])
    : { rows: [] as any[] };
  const stageByName: Record<string, string> = {};
  stagesResult.rows.forEach((r: any) => { stageByName[r.name.toLowerCase()] = r.id; });

  let imported = 0, updated = 0, skipped = 0;
  const errors: Array<{ row: number; reason: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name  = (r.name ?? '').trim();
    const email = (r.email ?? '').toLowerCase().trim();
    const phone = normalizePhone(r.phone ?? '');

    if (!name) { errors.push({ row: i + 1, reason: 'Missing name' }); continue; }

    const source     = (r.source ?? 'Import').trim();
    const dealValue  = r.deal_value ? parseFloat(String(r.deal_value).replace(/[^0-9.]/g, '')) || 0 : 0;
    const tags       = r.tags ? String(r.tags).split(',').map((t) => t.trim()).filter(Boolean) : [];
    const notesText  = (r.notes ?? '').trim();

    // Resolve stage: row's stage name overrides the default stage_id
    let resolvedStageId: string | null = stage_id ?? null;
    if (r.stage) {
      const sid = stageByName[String(r.stage).toLowerCase()];
      if (sid) resolvedStageId = sid;
    }

    // Collect custom field values (key = 'custom:slug')
    const customValues: Record<string, string> = {};
    for (const key of Object.keys(r)) {
      if (key.startsWith('custom:')) {
        const slug = key.slice(7);
        if (cfMap[slug] && r[key]) customValues[slug] = String(r[key]);
      }
    }

    try {
      // Duplicate check by phone or email
      let existingId: string | null = null;
      if (phone || email) {
        const check = await query(
          `SELECT id FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE
           AND (($2 <> '' AND phone=$2) OR ($3 <> '' AND email=$3)) LIMIT 1`,
          [tenantId, phone, email]
        );
        existingId = check.rows[0]?.id ?? null;
      }

      if (existingId && duplicate_handling === 'skip') { skipped++; continue; }

      let leadId: string;

      if (existingId && duplicate_handling === 'update') {
        await query(
          `UPDATE leads SET name=$2, email=$3, phone=$4, source=$5, deal_value=$6, tags=$7,
           pipeline_id=COALESCE($8::uuid, pipeline_id), stage_id=COALESCE($9::uuid, stage_id),
           updated_at=NOW() WHERE id=$1`,
          [existingId, name, email, phone, source, dealValue, tags,
           pipeline_id ?? null, resolvedStageId]
        );
        leadId = existingId;
        updated++;
      } else {
        const res2 = await query(
          `INSERT INTO leads (tenant_id, name, email, phone, source, pipeline_id, stage_id, deal_value, tags)
           VALUES ($1,$2,$3,$4,$5,$6::uuid,$7::uuid,$8,$9) RETURNING *`,
          [tenantId, name, email, phone, source,
           pipeline_id ?? null, resolvedStageId, dealValue, tags]
        );
        const newLead = res2.rows[0];
        leadId = newLead.id;
        imported++;
        await query(
          `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
           VALUES ($1,$2,'created','Imported',$3)`,
          [leadId, tenantId, userId]
        );
        // Fix 7: notification sent as a single summary after the loop — removed per-lead call here
        setImmediate(() => triggerWorkflows('lead_created', newLead, tenantId!, userId).catch(() => null));
      }

      // Insert note if provided
      if (notesText) {
        await query(
          `INSERT INTO lead_notes (lead_id, tenant_id, title, content, created_by)
           VALUES ($1,$2,'Import Note',$3,$4)`,
          [leadId, tenantId, cleanText(notesText), userId]
        );
      }

      // Insert custom field values
      for (const [slug, value] of Object.entries(customValues)) {
        const fieldId = cfMap[slug];
        if (fieldId) {
          await query(
            `INSERT INTO lead_field_values (lead_id, tenant_id, field_id, value)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (lead_id, field_id) DO UPDATE SET value=$4, updated_at=NOW()`,
            [leadId, tenantId, fieldId, value]
          );
        }
      }
    } catch (err: any) {
      errors.push({ row: i + 1, reason: err.code === '23505' ? 'Duplicate' : 'DB error' });
    }
  }

  // Fix 7: single summary notification instead of one per imported lead
  if (imported > 0) {
    sendBulkImportNotification(tenantId!, imported, userId!).catch(() => null);
  }
  res.json({ imported, updated, skipped, errors });
});

export default router;
