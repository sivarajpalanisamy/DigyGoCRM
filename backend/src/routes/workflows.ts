import { Router, Response } from 'express';
import type { Router as RouterType } from 'express';
import https from 'https';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission, hasPermission } from '../middleware/permissions';
import { checkPlan, checkUsage, incrementUsage } from '../middleware/plan';
import { sendEmail, isSmtpConfigured, getTenantEmailIdentity } from '../services/email';
import { decrypt } from '../utils/crypto';
import { maskPhone } from '../utils/phone';
import { emitToTenant, emitToUser } from '../socket';
import { emitLeadCreated } from '../utils/leadEvents';
import { backfillCustomFields, cleanFieldKey } from '../utils/customFields';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// ── CRUD ──────────────────────────────────────────────────────────────────────

router.get('/', checkPermission('automation:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT w.*,
              COALESCE(s.total_contacts, 0) AS total_contacts,
              COALESCE(s.completed,      0) AS completed,
              COALESCE(sk.skipped,       0) AS skipped,
              COALESCE(s.failed,         0) AS failed
       FROM workflows w
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)                                                     AS total_contacts,
           COUNT(*) FILTER (WHERE status = 'completed')                 AS completed,
           COUNT(*) FILTER (WHERE status = 'completed_with_errors')     AS completed_with_errors,
           COUNT(*) FILTER (WHERE status = 'failed')                    AS failed
         FROM (
           SELECT DISTINCT ON (COALESCE(lead_id::text, id::text)) status
           FROM workflow_executions
           WHERE workflow_id = w.id
           ORDER BY COALESCE(lead_id::text, id::text), enrolled_at DESC
         ) latest
       ) s ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT COALESCE(lead_id::text, id::text)) AS skipped
         FROM workflow_executions
         WHERE workflow_id = w.id AND status = 'skipped'
       ) sk ON true
       WHERE w.tenant_id=$1
       ORDER BY w.created_at DESC`,
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', checkPlan('basic_workflows'), checkPermission('automation:manage'), checkUsage('workflows'), async (req: AuthRequest, res: Response) => {
  const { name, description, nodes, status, allow_reentry } = req.body;
  const nodeList = nodes ?? [];
  const triggerNode = (nodeList as any[]).find((n: any) => n.type === 'trigger');
  const triggerKey   = triggerNode?.actionType ?? '';
  const triggerForms: string[] = Array.isArray(triggerNode?.config?.forms) ? triggerNode.config.forms : [];
  try {
    const result = await query(
      `INSERT INTO workflows (tenant_id, name, description, nodes, status, allow_reentry, trigger_key, trigger_forms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user!.tenantId, name ?? 'Untitled Automation', description ?? '',
       JSON.stringify(nodeList), status ?? 'inactive', allow_reentry ?? false,
       triggerKey, triggerForms]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Workflow Folders (must be before /:id to avoid capture) ──────────────────

router.get('/folders', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM workflow_folders WHERE tenant_id=$1 ORDER BY created_at ASC`,
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/folders', checkPermission('automation:manage'), async (req: AuthRequest, res: Response) => {
  const { name, workflow_ids } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return; }
  try {
    const result = await query(
      `INSERT INTO workflow_folders (tenant_id, name, workflow_ids) VALUES ($1,$2,$3) RETURNING *`,
      [req.user!.tenantId, name.trim(), JSON.stringify(workflow_ids ?? [])]
    );
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/folders/:id', checkPermission('automation:manage'), async (req: AuthRequest, res: Response) => {
  const { name, workflow_ids } = req.body;
  const fields: string[] = [];
  const params: any[] = [];
  if (name !== undefined)         { params.push(name);                         fields.push(`name=$${params.length}`); }
  if (workflow_ids !== undefined) { params.push(JSON.stringify(workflow_ids)); fields.push(`workflow_ids=$${params.length}`); }
  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  fields.push(`updated_at=NOW()`);
  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE workflow_folders SET ${fields.join(',')} WHERE id=$${params.length-1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/folders/:id', checkPermission('automation:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM workflow_folders WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user!.tenantId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Individual workflow CRUD (after /folders to avoid capture) ────────────────

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM workflows WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, req.user!.tenantId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/:id', checkPermission('automation:manage'), async (req: AuthRequest, res: Response) => {
  const { name, description, nodes, status, allow_reentry, base_updated_at } = req.body;
  const fields: string[] = [];
  const params: any[] = [];

  if (name !== undefined)          { params.push(name);                     fields.push(`name=$${params.length}`); }
  if (description !== undefined)   { params.push(description);              fields.push(`description=$${params.length}`); }
  if (nodes !== undefined)         {
    params.push(JSON.stringify(nodes));    fields.push(`nodes=$${params.length}`);
    // Keep denormalised trigger columns in sync so targeted queries stay accurate
    const triggerNode = (nodes as any[]).find((n: any) => n.type === 'trigger');
    const triggerKey   = triggerNode?.actionType ?? '';
    const triggerForms: string[] = Array.isArray(triggerNode?.config?.forms) ? triggerNode.config.forms : [];
    params.push(triggerKey);  fields.push(`trigger_key=$${params.length}`);
    params.push(triggerForms); fields.push(`trigger_forms=$${params.length}`);
  }
  if (status !== undefined) {
    if (status === 'active') {
      // Resolve the trigger_key — either from the nodes being saved now, or from the DB
      let effectiveTriggerKey = '';
      if (nodes !== undefined) {
        const triggerNode = (nodes as any[]).find((n: any) => n.type === 'trigger');
        effectiveTriggerKey = triggerNode?.actionType ?? '';
      } else {
        const cur = await query('SELECT trigger_key FROM workflows WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user!.tenantId]);
        effectiveTriggerKey = cur.rows[0]?.trigger_key ?? '';
      }
      if (!effectiveTriggerKey) {
        res.status(400).json({ error: 'Without a trigger, this automation won\'t run. Set up a trigger first.' });
        return;
      }
    }
    params.push(status); fields.push(`status=$${params.length}`);
  }
  if (allow_reentry !== undefined) { params.push(allow_reentry);            fields.push(`allow_reentry=$${params.length}`); }

  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  fields.push(`updated_at=NOW()`);
  params.push(req.params.id);      const idIdx = params.length;
  params.push(req.user!.tenantId); const tenantIdx = params.length;

  // Optimistic concurrency: only save if the caller's base version matches the
  // current row (i.e. nobody — another tab/user — saved in between). This makes a
  // stale tab physically unable to overwrite newer data.
  let guard = '';
  if (base_updated_at) {
    params.push(base_updated_at);
    guard = ` AND updated_at <= $${params.length}::timestamptz`;
  }

  try {
    const result = await query(
      `UPDATE workflows SET ${fields.join(',')} WHERE id=$${idIdx} AND tenant_id=$${tenantIdx}${guard} RETURNING *`,
      params
    );
    if (!result.rows[0]) {
      // No row updated — distinguish "not found" from "stale (conflict)".
      const existing = await query(
        'SELECT updated_at FROM workflows WHERE id=$1 AND tenant_id=$2',
        [req.params.id, req.user!.tenantId]
      );
      if (existing.rows[0]) {
        res.status(409).json({ error: 'This automation was changed elsewhere (another tab/session). Reload to get the latest before saving.', current_updated_at: existing.rows[0].updated_at });
        return;
      }
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', checkPermission('automation:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM workflows WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user!.tenantId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id/logs', async (req: AuthRequest, res: Response) => {
  try {
    const { userId, role, tenantId } = req.user!;
    let onlyAssigned = false;
    let shouldMaskPhone = false;
    if (role !== 'super_admin') {
      try { onlyAssigned = await hasPermission(userId, 'leads:only_assigned', tenantId); } catch { onlyAssigned = true; }
      try { shouldMaskPhone = await hasPermission(userId, 'leads:mask_phone', tenantId); } catch {}
    }
    const params: any[] = [req.params.id, req.user!.tenantId];
    let assignedFilter = '';
    if (onlyAssigned) {
      params.push(userId);
      assignedFilter = ` AND ld.assigned_to = $${params.length}`;
    }
    const result = await query(
      `SELECT e.*, ld.phone AS lead_phone,
              json_agg(l ORDER BY l.created_at ASC) FILTER (WHERE l.id IS NOT NULL) AS steps
       FROM workflow_executions e
       LEFT JOIN leads ld ON ld.id = e.lead_id
       LEFT JOIN workflow_execution_logs l ON l.execution_id = e.id
       WHERE e.workflow_id=$1 AND e.tenant_id=$2${assignedFilter}
       GROUP BY e.id, ld.phone
       ORDER BY e.enrolled_at DESC
       LIMIT 5000`,
      params
    );
    const rows = shouldMaskPhone
      ? result.rows.map((r: any) => ({ ...r, lead_phone: maskPhone(r.lead_phone) }))
      : result.rows;
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Execution Engine ──────────────────────────────────────────────────────────

interface WFNode {
  id: string;
  type: 'trigger' | 'action' | 'condition' | 'delay';
  actionType: string;
  label: string;
  config: Record<string, any>;
  branches?: { yes: WFNode[]; no: WFNode[] };
}

export interface LeadContext {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  stage_id?: string;
  stage_name?: string;
  pipeline_id?: string;
  pipeline_name?: string;
  assigned_to?: string;
  assigned_staff_name?: string;
  assigned_staff_id?: string;
  tags?: string[];
  source?: string;
  status?: string;
  custom_fields?: Record<string, any>;
  form_id?: string;
  form_name?: string;
  created_at?: string;
  event_type_id?: string;
  calendar_name?: string;
  appointment_date?: string;
  appointment_start_time?: string;
  appointment_end_time?: string;
  appointment_timezone?: string;
  meeting_link?: string;
}

// Matches the slugify() on FieldsPage — converts a value_token name to its {%slug%} key.
function slugifyToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/, '').slice(0, 40);
}

// Replaces {%slug%} and {variable} placeholders with actual lead values.
// Supports all slugs from the Fields page (contact.*, company.*, calendar.*).
// valueTokens: rows from value_tokens table — substituted last for {%key%} not found in lead data.
export function interpolate(
  template: string,
  lead: LeadContext,
  valueTokens: Array<{ name: string; replace_with: string }> = []
): string {
  if (!template) return template;
  const nameParts = (lead.name ?? '').trim().split(/\s+/);
  const cf = (lead.custom_fields ?? {}) as Record<string, string>;
  const vars: Record<string, string> = {
    // short-form aliases (legacy {field} format)
    first_name:             nameParts[0] ?? '',
    last_name:              nameParts.length > 1 ? nameParts[nameParts.length - 1] : '',
    full_name:              lead.name ?? '',
    name:                   lead.name ?? '',
    email:                  lead.email ?? '',
    phone:                  lead.phone ?? '',
    phone_intl:             (() => { const p = (lead.phone ?? '').replace(/\D/g, ''); if (!p) return ''; if (p.startsWith('91') && p.length >= 12) return `+${p}`; return `+91${p}`; })(),
    stage:                  lead.stage_name ?? '',
    pipeline:               lead.pipeline_name ?? '',
    assigned_staff:         lead.assigned_staff_name ?? '',
    assigned_staff_id:      lead.assigned_staff_id ?? '',
    source:                 lead.source ?? '',
    status:                 lead.status ?? '',
    created_at:             lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
    form_name:              lead.form_name ?? '',
    today:                  new Date().toLocaleDateString(),
    date:                   new Date().toLocaleDateString(),
    time:                   new Date().toLocaleTimeString(),
    // contact.* slug aliases — matches Fields page exactly
    contact_source:         lead.source ?? '',
    assigned_to_staff:      lead.assigned_staff_name ?? '',
    opportunity_name:       cf.opportunity_name ?? '',
    lead_value:             cf.lead_value ?? '',
    opportunity_source:     cf.opportunity_source ?? '',
    contact_type:           cf.contact_type ?? '',
    business_name:          cf.business_name ?? '',
    gst_no:                 cf.gst_no ?? '',
    state:                  cf.state ?? '',
    street_address:         cf.street_address ?? '',
    date_of_birth:          cf.date_of_birth ?? '',
    postal_code:            cf.postal_code ?? '',
    profile_image:          cf.profile_image ?? '',
    // calendar fields — from lead context (set at trigger time), fallback to custom_fields
    appointment_date:       lead.appointment_date ?? cf.appointment_date ?? '',
    appointment_start_time: lead.appointment_start_time ?? cf.appointment_start_time ?? '',
    appointment_end_time:   lead.appointment_end_time ?? cf.appointment_end_time ?? '',
    appointment_timezone:   lead.appointment_timezone ?? cf.appointment_timezone ?? '',
    meeting_link:           lead.meeting_link ?? cf.meeting_link ?? '',
    calendar_name:          lead.calendar_name ?? '',
    // spread all custom fields so any user-created slug works
    ...cf,
  };

  // Step 1: {%ns.slug%} — use lead var; preserve token if key not found (value_tokens handles it)
  const step1 = template.replace(/\{%([\w]+)\.([\w]+)%\}/g, (match, _ns, key) =>
    key in vars ? vars[key] : match
  );
  // Step 2: {%slug%} — use lead var; preserve token if key not found
  const step2 = step1.replace(/\{%([\w]+)%\}/g, (match, key) =>
    key in vars ? vars[key] : match
  );
  // Step 3: {field} legacy format — preserve if not found
  let result = step2.replace(/\{([\w]+)\}/g, (match, key) =>
    key in vars ? vars[key] : match
  );
  // Step 4: resolve remaining {%key%} via Values table — match by slugified name (same as Fields page)
  for (const token of valueTokens) {
    const slug = slugifyToken(token.name);
    result = result.replace(new RegExp(`\\{%${slug}%\\}`, 'g'), token.replace_with);
  }
  // Step 5: any token still unresolved (field has no data / unknown slug) → empty string,
  // so output never contains a literal {%slug%}.
  result = result.replace(/\{%[^%]*%\}/g, '');
  return result;
}


async function logStep(
  executionId: string, workflowId: string, tenantId: string,
  node: WFNode, status: string, message: string
): Promise<void> {
  await query(
    `INSERT INTO workflow_execution_logs
       (execution_id, workflow_id, tenant_id, node_id, action_type, status, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [executionId, workflowId, tenantId, node.id ?? `node-${Date.now()}`, node.actionType ?? 'unknown', status, message]
  ).catch((err: any) => console.error('[logStep]', node.actionType, err.message));
}

interface ExecStats { skipped: number; failed: number; exit?: boolean }

// Leak 5 fix: WhatsApp text send via WABA integration (mirrors conversations.ts pattern)
function sendWAText(phoneNumberId: string, token: string, toPhone: string, text: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      messaging_product: 'whatsapp',
      to: toPhone.replace(/\D/g, ''),
      type: 'text',
      text: { body: text },
    });
    const options = {
      hostname: 'graph.facebook.com',
      path: `/v17.0/${phoneNumberId}/messages`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from WhatsApp API')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Leak 7 fix: sync a tag name to the tags + lead_tags junction tables so tag-based
// filtering (which queries lead_tags) stays consistent with workflow-written tags.
async function syncTagToJunction(tenantId: string, leadId: string, tagName: string): Promise<void> {
  const tagRow = await query(
    `INSERT INTO tags (tenant_id, name, color) VALUES ($1,$2,'#94a3b8')
     ON CONFLICT (tenant_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
    [tenantId, tagName]
  ).catch(() => null);
  if (tagRow?.rows[0]) {
    await query(
      `INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [leadId, tagRow.rows[0].id]
    ).catch(() => null);
  }
}

async function unsyncTagFromJunction(tenantId: string, leadId: string, tagName: string): Promise<void> {
  await query(
    `DELETE FROM lead_tags WHERE lead_id=$1
     AND tag_id=(SELECT id FROM tags WHERE tenant_id=$2 AND name=$3 LIMIT 1)`,
    [leadId, tenantId, tagName]
  ).catch(() => null);
}

// Returns userId only if it's a valid UUID (safe to insert into UUID columns).
// Callers like public.ts pass 'system' / 'historical' which are not UUIDs.
function uuidOrNull(id: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

function adjustToTimeWindow(dt: Date, start: string, end: string, days: string[]): Date {
  const DAY_NAMES = ['sun','mon','tue','wed','thu','fri','sat'];
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins   = eh * 60 + em;
  for (let i = 0; i < 14; i++) {
    const dayName  = DAY_NAMES[dt.getDay()];
    const currMins = dt.getHours() * 60 + dt.getMinutes();
    if (days.includes(dayName)) {
      if (currMins < startMins) { const r = new Date(dt); r.setHours(sh, sm, 0, 0); return r; }
      if (currMins < endMins)   return dt;
    }
    dt = new Date(dt);
    dt.setDate(dt.getDate() + 1);
    dt.setHours(sh, sm, 0, 0);
  }
  return dt;
}

export async function executeNodes(
  nodes: WFNode[],
  lead: LeadContext,
  tenantId: string,
  userId: string,
  executionId: string,
  workflowId: string
): Promise<ExecStats> {
  const safeUserId = uuidOrNull(userId);
  const stats: ExecStats = { skipped: 0, failed: 0 };

  // Fetch value_tokens once per execution — used in all interpolate() calls below
  const valueTokens = await query(
    'SELECT name, replace_with FROM value_tokens WHERE tenant_id=$1',
    [tenantId]
  ).then((r) => r.rows as Array<{ name: string; replace_with: string }>)
   .catch(() => [] as Array<{ name: string; replace_with: string }>);

  for (const node of nodes) {
    if (node.type === 'trigger') continue;

    let status = 'completed';
    let message = '';

    try {
      switch (node.actionType) {

        // ── Add / Update to CRM ────────────────────────────────────────────────
        case 'add_to_crm': {
          // Skip if lead already has a pipeline and "only_if_no_pipeline" is toggled
          if (node.config.only_if_no_pipeline && lead.pipeline_id) {
            status = 'skipped';
            message = `add_to_crm: lead already in a pipeline — skipped (only_if_no_pipeline is ON)`;
            break;
          }
          if (!lead.id) {
            status = 'failed';
            message = 'add_to_crm: lead has no id — cannot update';
            break;
          }
          const sets: string[] = ['updated_at=NOW()'];
          const vals: any[] = [];
          if (node.config.pipeline_id) { vals.push(node.config.pipeline_id); sets.push(`pipeline_id=$${vals.length}`); }
          if (node.config.stage_id)    { vals.push(node.config.stage_id);    sets.push(`stage_id=$${vals.length}`); }
          if (node.config.deal_value !== undefined && node.config.deal_value !== '') {
            vals.push(Number(node.config.deal_value));
            sets.push(`deal_value=$${vals.length}`);
          }
          if (sets.length > 1) {
            vals.push(lead.id, tenantId);
            console.log(`[add_to_crm] lead.id=${lead.id} tenantId=${tenantId} sets=${sets.join(',')}`);
            const updateRes = await query(
              `UPDATE leads SET ${sets.join(',')} WHERE id=$${vals.length - 1}::uuid AND tenant_id=$${vals.length}::uuid RETURNING pipeline_id, stage_id`,
              vals
            );
            console.log(`[add_to_crm] rows returned: ${updateRes.rows.length}`);
            const vRow = updateRes.rows[0];
            const stageName = node.config.stage_id
              ? (await query('SELECT name FROM pipeline_stages WHERE id=$1', [node.config.stage_id])).rows[0]?.name ?? ''
              : '';
            if (!vRow) {
              status = 'failed';
              message = 'add_to_crm: lead not found in database';
            } else if (node.config.pipeline_id && vRow.pipeline_id !== node.config.pipeline_id) {
              status = 'failed';
              message = `add_to_crm: lead not placed in configured pipeline after update`;
            } else if (node.config.stage_id && vRow.stage_id !== node.config.stage_id) {
              status = 'failed';
              message = `add_to_crm: lead not placed in configured stage after update`;
            } else {
              message = stageName ? `Added to CRM · ${stageName}` : 'Added to CRM';
              if (node.config.pipeline_id) {
                lead.pipeline_id = node.config.pipeline_id as string;
                const pnRes = await query('SELECT name FROM pipelines WHERE id=$1', [node.config.pipeline_id]).catch(() => ({ rows: [] as any[] }));
                lead.pipeline_name = pnRes.rows[0]?.name ?? '';
              }
              if (node.config.stage_id) {
                lead.stage_id = node.config.stage_id as string;
                lead.stage_name = stageName;
              }
              if (node.config.stage_id) {
                const updatedLead2 = (await query('SELECT * FROM leads WHERE id=$1', [lead.id])).rows[0];
                if (updatedLead2) setImmediate(() => triggerWorkflows('stage_changed', { ...updatedLead2, stage_name: stageName }, tenantId, safeUserId ?? userId).catch(() => null));
              }
            }
          } else {
            status = 'skipped';
            message = 'add_to_crm: no pipeline_id or stage_id configured — select a pipeline and stage in the node config';
          }
          break;
        }

        // ── Change Pipeline Stage ──────────────────────────────────────────────
        case 'change_stage': {
          const stageId = node.config.stage_id as string;
          if (stageId && lead.id) {
            await query(
              `UPDATE leads SET stage_id=$1::uuid, updated_at=NOW() WHERE id=$2::uuid AND tenant_id=$3::uuid`,
              [stageId, lead.id, tenantId]
            );
            const sr = await query('SELECT name FROM pipeline_stages WHERE id=$1', [stageId]);
            const stageName = sr.rows[0]?.name ?? stageId;
            const vStage = await query('SELECT stage_id FROM leads WHERE id=$1::uuid AND tenant_id=$2::uuid', [lead.id, tenantId]);
            if (vStage.rows[0]?.stage_id !== stageId) {
              status = 'failed'; message = 'change_stage: stage was not updated on lead';
            } else {
              message = `Moved to ${stageName}`;
              lead.stage_id = stageId;
              lead.stage_name = stageName;
              // Re-fetch with JOIN so socket carries assigned_name display field
              const updatedLead = await query(
                `SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id=l.assigned_to WHERE l.id=$1`,
                [lead.id]
              ).catch(() => ({ rows: [] as any[] }));
              if (updatedLead.rows[0]) emitToTenant(tenantId, 'lead:updated', updatedLead.rows[0]);
              const raw = (await query('SELECT * FROM leads WHERE id=$1', [lead.id])).rows[0];
              if (raw) setImmediate(() => triggerWorkflows('stage_changed', { ...raw, stage_name: stageName }, tenantId, safeUserId ?? userId).catch(() => null));
            }
          } else {
            status = 'skipped'; message = 'change_stage: no stage_id configured';
          }
          break;
        }

        // ── Assign To Staff ────────────────────────────────────────────────────
        case 'assign_staff': {
          const assignMode = (node.config.assign_mode as string) ?? 'specific';

          // ── Round Robin mode: cycle through (pipeline, stage, staff) pairs ──
          if (assignMode === 'round_robin') {
            const pairs = (node.config.round_robin_pairs as Array<{ pipeline_id: string; stage_id: string; staff_id: string }>) ?? [];
            if (!pairs.length) { status = 'skipped'; message = 'assign_staff: no round-robin pairs configured'; break; }

            const nodeId = node.id ?? 'default';
            const counters = await query(
              `SELECT staff_id, count FROM workflow_staff_counters WHERE workflow_id=$1 AND node_id=$2`,
              [workflowId, nodeId]
            ).catch(() => ({ rows: [] as any[] }));

            // Use "pair_N" as the key so indices don't clash with real staff UUIDs
            const countMap: Record<string, number> = {};
            for (let i = 0; i < pairs.length; i++) countMap[`pair_${i}`] = 0;
            for (const row of counters.rows) {
              if (countMap[row.staff_id] !== undefined) countMap[row.staff_id] = Number(row.count);
            }

            // Pick pair with lowest count; ties resolved by order
            let pairIdx = 0;
            let minCount = Infinity;
            for (let i = 0; i < pairs.length; i++) {
              const c = countMap[`pair_${i}`] ?? 0;
              if (c < minCount) { minCount = c; pairIdx = i; }
            }
            const pair = pairs[pairIdx];
            const pairKey = `pair_${pairIdx}`;

            if (!pair.staff_id) { status = 'skipped'; message = `assign_staff: pair ${pairIdx + 1} has no staff`; break; }

            // Move to pipeline + stage and assign staff in one UPDATE
            await query(
              `UPDATE leads SET pipeline_id=$1, stage_id=$2, assigned_to=$3::uuid, updated_at=NOW()
               WHERE id=$4::uuid AND tenant_id=$5::uuid`,
              [pair.pipeline_id || null, pair.stage_id || null, pair.staff_id, lead.id, tenantId]
            );

            // Increment counter
            await query(
              `INSERT INTO workflow_staff_counters (workflow_id, node_id, staff_id, count) VALUES ($1,$2,$3,1)
               ON CONFLICT (workflow_id, node_id, staff_id) DO UPDATE SET count = workflow_staff_counters.count + 1`,
              [workflowId, nodeId, pairKey]
            ).catch(() => null);

            // Sync in-memory lead context for subsequent nodes
            lead.pipeline_id = pair.pipeline_id;
            lead.stage_id    = pair.stage_id;
            lead.assigned_to = pair.staff_id;
            const [rStaff, rPipeline, rStage] = await Promise.all([
              query('SELECT name, staff_id FROM users WHERE id=$1', [pair.staff_id]).catch(() => ({ rows: [] })),
              query('SELECT name FROM pipelines       WHERE id=$1', [pair.pipeline_id]).catch(() => ({ rows: [] })),
              query('SELECT name FROM pipeline_stages WHERE id=$1', [pair.stage_id]).catch(() => ({ rows: [] })),
            ]);
            lead.assigned_staff_name = (rStaff as any).rows[0]?.name ?? '';
            lead.assigned_staff_id   = (rStaff as any).rows[0]?.staff_id ?? '';
            lead.pipeline_name       = (rPipeline as any).rows[0]?.name ?? '';
            lead.stage_name          = (rStage as any).rows[0]?.name ?? '';
            message = `Round-robin pair ${pairIdx + 1}: ${lead.pipeline_name} → ${lead.assigned_staff_name}`;
            break;
          }

          // By-pipeline mode: resolve staff from pipeline→staff mapping
          if (assignMode === 'by_pipeline') {
            const mapping = (node.config.pipeline_staff_mapping as Array<{ pipeline_id: string; staff_ids?: string[]; staff_id?: string }>) ?? [];
            const match = mapping.find((m) => m.pipeline_id === lead.pipeline_id);
            const pipelineStaffIds: string[] = match?.staff_ids?.length
              ? match.staff_ids
              : (match?.staff_id ? [match.staff_id] : []);
            if (!pipelineStaffIds.length) {
              status = 'skipped';
              message = `assign_staff: no pipeline mapping for "${lead.pipeline_name ?? lead.pipeline_id ?? 'unknown pipeline'}"`;
              break;
            }
            (node.config as any).staff_ids = pipelineStaffIds;
          }
          const staffIds: string[] = Array.isArray(node.config.staff_ids)
            ? (node.config.staff_ids as string[])
            : node.config.staff_id ? [node.config.staff_id as string] : [];
          if (staffIds.length > 0 && lead.id) {
            const onlyUnassigned = !!(node.config.unassignedOnly);
            if (onlyUnassigned) {
              const existing = await query('SELECT assigned_to FROM leads WHERE id=$1', [lead.id]);
              if (existing.rows[0]?.assigned_to) { status = 'skipped'; message = 'assign_staff: lead already assigned'; break; }
            }
            let staffId: string;

            if (staffIds.length === 1) {
              staffId = staffIds[0];
            } else {
              const splitMode = (node.config.split_traffic as string) ?? 'evenly';

              if (splitMode === 'weighted') {
                // Weighted random — pick based on configured percentages
                const weights = (node.config.staff_weights as Record<string, number>) ?? {};
                const totalWeight = staffIds.reduce((s, id) => s + (weights[id] ?? 1), 0);
                let rand = Math.random() * totalWeight;
                staffId = staffIds[staffIds.length - 1]; // fallback
                for (const id of staffIds) {
                  rand -= (weights[id] ?? 1);
                  if (rand <= 0) { staffId = id; break; }
                }
              } else {
                // Evenly — true round-robin via per-workflow per-node DB counters
                const nodeId = node.id ?? 'default';
                const counters = await query(
                  `SELECT staff_id, count FROM workflow_staff_counters
                   WHERE workflow_id=$1 AND node_id=$2`,
                  [workflowId, nodeId]
                ).catch(() => ({ rows: [] as any[] }));

                // Build count map — staff not yet in table default to 0
                const countMap: Record<string, number> = {};
                for (const id of staffIds) countMap[id] = 0;
                for (const row of counters.rows) {
                  if (countMap[row.staff_id] !== undefined) countMap[row.staff_id] = Number(row.count);
                }

                // Pick staff with lowest assignment count; ties broken by array order
                staffId = staffIds.reduce((best, id) => countMap[id] < countMap[best] ? id : best, staffIds[0]);
              }

              // Increment counter for the chosen staff member (tracks distribution)
              await query(
                `INSERT INTO workflow_staff_counters (workflow_id, node_id, staff_id, count)
                 VALUES ($1,$2,$3,1)
                 ON CONFLICT (workflow_id, node_id, staff_id)
                 DO UPDATE SET count = workflow_staff_counters.count + 1`,
                [workflowId, node.id ?? 'default', staffId]
              ).catch(() => null);
            }

            await query(
              `UPDATE leads SET assigned_to=$1::uuid, updated_at=NOW() WHERE id=$2::uuid AND tenant_id=$3::uuid`,
              [staffId, lead.id, tenantId]
            );
            const ur = await query('SELECT name, staff_id FROM users WHERE id=$1', [staffId]);
            const vStaff = await query('SELECT assigned_to FROM leads WHERE id=$1::uuid AND tenant_id=$2::uuid', [lead.id, tenantId]);
            if (vStaff.rows[0]?.assigned_to !== staffId) {
              status = 'failed'; message = `assign_staff: lead was not assigned to ${ur.rows[0]?.name ?? staffId}`;
            } else {
              lead.assigned_to = staffId;
              lead.assigned_staff_name = ur.rows[0]?.name ?? '';
              lead.assigned_staff_id   = ur.rows[0]?.staff_id ?? '';
              message = `Assigned: ${ur.rows[0]?.name ?? staffId}`;
            }
          } else {
            status = 'skipped'; message = 'assign_staff: no staff configured';
          }
          break;
        }

        // ── Remove Assigned Staff ──────────────────────────────────────────────
        case 'remove_staff': {
          if (lead.id) {
            await query(
              `UPDATE leads SET assigned_to=NULL, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`,
              [lead.id, tenantId]
            );
            const vRemove = await query('SELECT assigned_to FROM leads WHERE id=$1 AND tenant_id=$2', [lead.id, tenantId]);
            if (vRemove.rows[0]?.assigned_to !== null) {
              status = 'failed'; message = 'remove_staff: staff assignment was not cleared';
            } else {
              lead.assigned_to = undefined as any;
              lead.assigned_staff_name = '';
              message = 'Staff unassigned';
            }
          }
          break;
        }

        // ── Add Tag / Tag Contact ──────────────────────────────────────────────
        case 'add_tag':
        case 'tag_contact': {
          const tagList: string[] = Array.isArray(node.config.tags)
            ? (node.config.tags as string[]).filter(Boolean)
            : [(node.config.tag ?? node.config.tagName) as string].filter(Boolean);
          if (tagList.length && lead.id) {
            for (const t of tagList) {
              await query(
                `UPDATE leads SET tags=array_append(COALESCE(tags, '{}'), $1::text), updated_at=NOW()
                 WHERE id=$2::uuid AND tenant_id=$3::uuid AND NOT (COALESCE($1=ANY(tags), false))`,
                [t, lead.id, tenantId]
              );
              await syncTagToJunction(tenantId, lead.id, t);
            }
            // Verify every tag was actually added
            const vTags = await query(
              `SELECT tags FROM leads WHERE id=$1::uuid AND tenant_id=$2::uuid`,
              [lead.id, tenantId]
            );
            const actualTags: string[] = vTags.rows[0]?.tags ?? [];
            const missing = tagList.filter((t) => !actualTags.includes(t));
            if (missing.length > 0) {
              status = 'failed';
              message = `add_tag: tag(s) not found on lead after update: ${missing.join(', ')}`;
            } else {
              lead.tags = actualTags;
              message = `Tags added: ${tagList.join(', ')}`;
            }
          } else {
            status = 'skipped'; message = 'add_tag: no tags configured';
          }
          break;
        }

        // ── Remove Tag ─────────────────────────────────────────────────────────
        case 'remove_tag': {
          const tagList: string[] = Array.isArray(node.config.tags)
            ? (node.config.tags as string[]).filter(Boolean)
            : [(node.config.tag) as string].filter(Boolean);
          if (tagList.length && lead.id) {
            for (const t of tagList) {
              await query(
                `UPDATE leads SET tags=array_remove(tags, $1::text), updated_at=NOW()
                 WHERE id=$2 AND tenant_id=$3`,
                [t, lead.id, tenantId]
              );
              await unsyncTagFromJunction(tenantId, lead.id, t);
            }
            // Verify all tags were actually removed
            const vRmTags = await query(
              `SELECT tags FROM leads WHERE id=$1 AND tenant_id=$2`,
              [lead.id, tenantId]
            );
            const remainingTags: string[] = vRmTags.rows[0]?.tags ?? [];
            const stillPresent = tagList.filter((t) => remainingTags.includes(t));
            if (stillPresent.length > 0) {
              status = 'failed';
              message = `remove_tag: tag(s) still present on lead after removal: ${stillPresent.join(', ')}`;
            } else {
              lead.tags = remainingTags;
              message = `Tags removed: ${tagList.join(', ')}`;
            }
          } else {
            status = 'skipped'; message = 'remove_tag: no tag configured';
          }
          break;
        }

        // ── Change Lead Quality ────────────────────────────────────────────────
        case 'change_lead_quality': {
          const quality = node.config.quality as string;
          if (quality && lead.id) {
            await query(
              `UPDATE leads SET custom_fields = COALESCE(custom_fields,'{}')::jsonb || $1::jsonb, updated_at=NOW()
               WHERE id=$2 AND tenant_id=$3`,
              [JSON.stringify({ lead_quality: quality }), lead.id, tenantId]
            );
            const vQuality = await query(
              `SELECT custom_fields->>'lead_quality' AS lq FROM leads WHERE id=$1 AND tenant_id=$2`,
              [lead.id, tenantId]
            );
            if (vQuality.rows[0]?.lq !== quality) {
              status = 'failed'; message = `change_lead_quality: value not set correctly after update`;
            } else {
              message = `Quality: ${quality}`;
            }
          } else {
            status = 'skipped'; message = 'change_lead_quality: no quality configured';
          }
          break;
        }

        // ── Update Contact Attributes ──────────────────────────────────────────
        case 'update_attributes': {
          if (!lead.id) { status = 'skipped'; message = 'update_attributes: no lead ID'; break; }
          const directCols = new Set(['name', 'email', 'phone', 'source', 'deal_value', 'assigned_to', 'stage_id', 'pipeline_id']);
          const sets: string[] = ['updated_at=NOW()'];
          const vals: any[] = [];
          const jsonbMerge: Record<string, string> = {};

          const processField = (fieldKey: string, rawValue: string) => {
            const v = interpolate(rawValue, lead, valueTokens);
            if (directCols.has(fieldKey)) {
              vals.push(v); sets.push(`${fieldKey}=$${vals.length}`);
            } else if (fieldKey === 'lead_quality') {
              jsonbMerge['lead_quality'] = v;
            } else if (fieldKey.startsWith('custom:')) {
              const slug = fieldKey.slice(7);
              if (slug) jsonbMerge[slug] = v;
            }
          };

          // New UI sends attrField/attrValue (single field at a time)
          // Old UI sent name/email/phone/source directly on config
          if (node.config.attrField && node.config.attrValue !== undefined) {
            processField((node.config.attrField as string).trim(), node.config.attrValue as string);
          } else {
            for (const field of directCols) {
              if (node.config[field] !== undefined && node.config[field] !== '') {
                processField(field, node.config[field] as string);
              }
            }
          }

          if (Object.keys(jsonbMerge).length > 0) {
            vals.push(JSON.stringify(jsonbMerge));
            sets.push(`custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $${vals.length}::jsonb`);
          }

          if (sets.length > 1) {
            vals.push(lead.id, tenantId);
            await query(
              `UPDATE leads SET ${sets.join(',')} WHERE id=$${vals.length - 1} AND tenant_id=$${vals.length}`,
              vals
            );
            // Sync simple scalar fields back onto the in-memory lead
            const fieldValuePairs: Record<string, string> = {};
            if (node.config.attrField && node.config.attrValue !== undefined) {
              fieldValuePairs[(node.config.attrField as string).trim()] = interpolate(node.config.attrValue as string, lead, valueTokens);
            } else {
              for (const field of directCols) {
                if (node.config[field] !== undefined && node.config[field] !== '') {
                  fieldValuePairs[field] = interpolate(node.config[field] as string, lead, valueTokens);
                }
              }
            }
            for (const [field, val] of Object.entries(fieldValuePairs)) {
              (lead as any)[field] = val;
            }
            // Resolve human-readable names for ID fields that were updated
            if (fieldValuePairs.pipeline_id) {
              const r = await query('SELECT name FROM pipelines WHERE id=$1', [fieldValuePairs.pipeline_id]).catch(() => ({ rows: [] }));
              lead.pipeline_name = r.rows[0]?.name ?? '';
            }
            if (fieldValuePairs.stage_id) {
              const r = await query('SELECT name FROM pipeline_stages WHERE id=$1', [fieldValuePairs.stage_id]).catch(() => ({ rows: [] }));
              lead.stage_name = r.rows[0]?.name ?? '';
            }
            if (fieldValuePairs.assigned_to) {
              const r = await query('SELECT name FROM users WHERE id=$1', [fieldValuePairs.assigned_to]).catch(() => ({ rows: [] }));
              lead.assigned_staff_name = r.rows[0]?.name ?? '';
            }
            const updatedCols = [
              ...sets.slice(1).filter((s) => !s.startsWith('custom_fields')).map((s) => s.split('=')[0]),
              ...Object.keys(jsonbMerge),
            ];
            message = `Updated: ${updatedCols.join(', ')}`;
          } else {
            status = 'skipped'; message = 'update_attributes: no field/value configured';
          }
          break;
        }

        // ── Remove from CRM (soft-delete lead) ────────────────────────────────
        case 'remove_from_crm': {
          if (lead.id && !lead.id.startsWith('test-')) {
            await query(
              `UPDATE leads SET is_deleted=TRUE, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`,
              [lead.id, tenantId]
            );
            const vDel = await query('SELECT is_deleted FROM leads WHERE id=$1 AND tenant_id=$2', [lead.id, tenantId]);
            if (!vDel.rows[0]?.is_deleted) {
              status = 'failed'; message = 'remove_from_crm: lead was not marked as deleted';
            } else {
              message = 'Lead removed from CRM';
            }
          } else if (lead.id?.startsWith('test-')) {
            status = 'skipped'; message = 'remove_from_crm: test contact is not a real CRM lead';
          }
          break;
        }

        // ── Remove from Contact Group ──────────────────────────────────────────
        case 'remove_contact': {
          const groupId = (node.config.group_id ?? '') as string;
          if (!groupId) {
            if (node.config.targetList) {
              status = 'failed'; message = 'remove_contact: action needs reconfiguration — open this node and select a Contact Group from the dropdown';
            } else {
              status = 'skipped'; message = 'remove_contact: no group configured';
            }
            break;
          }
          if (!lead.id) { status = 'skipped'; message = 'remove_contact: no lead ID'; break; }
          const rcGrp = await query(
            `SELECT name FROM contact_groups WHERE id=$1::uuid AND tenant_id=$2::uuid`,
            [groupId, tenantId]
          );
          if (!rcGrp.rows[0]) { status = 'skipped'; message = 'remove_contact: group not found or belongs to another tenant'; break; }
          await query(
            `DELETE FROM contact_group_members WHERE group_id=$1::uuid AND lead_id=$2::uuid`,
            [groupId, lead.id]
          );
          message = `Removed from group: ${rcGrp.rows[0].name}`;
          break;
        }

        // ── Add Note ───────────────────────────────────────────────────────────
        case 'create_note': {
          const rawContent = (node.config.noteContent ?? node.config.content ?? node.config.message) as string ?? 'Automated note';
          const content = interpolate(rawContent, lead, valueTokens);
          if (lead.id && !lead.id.startsWith('test-')) {
            const noteRes = await query(
              `INSERT INTO lead_notes (lead_id, tenant_id, title, content, created_by)
               VALUES ($1,$2,$3,$4,$5) RETURNING id`,
              [lead.id, tenantId, 'Workflow Note', content, safeUserId]
            );
            if (!noteRes.rows[0]?.id) {
              status = 'failed'; message = 'create_note: note was not created in database';
            } else {
              message = `Note: ${content.slice(0, 80)}`;
              setImmediate(() => triggerWorkflows('notes_added', lead, tenantId, safeUserId ?? userId).catch(() => null));
            }
          } else {
            status = 'skipped';
            message = lead.id?.startsWith('test-')
              ? 'create_note: test contact is not a real CRM lead — use a contact from CRM to test this action'
              : 'create_note: no lead ID';
          }
          break;
        }

        // ── Create Follow-up ───────────────────────────────────────────────────
        case 'create_followup': {
          const title = (node.config.title ?? 'Workflow Follow-up') as string;
          // Support both due_hours (legacy) and dueDays/dueUnit (editor UI)
          let dueHours = 24;
          if (node.config.due_hours) {
            dueHours = parseInt(node.config.due_hours as string) || 24;
          } else if (node.config.dueDays) {
            const val  = parseFloat(node.config.dueDays as string) || 1;
            const unit = (node.config.dueUnit as string) ?? 'days';
            if      (unit === 'minutes') dueHours = val / 60;
            else if (unit === 'hours')   dueHours = val;
            else                         dueHours = val * 24;
          }
          const dueAt = new Date(Date.now() + dueHours * 3600000).toISOString();
          if (lead.id && !lead.id.startsWith('test-')) {
            const rawAssignTo = (node.config.assignTo ?? userId) as string;
            const assignTo = uuidOrNull(rawAssignTo);
            const fuRes = await query(
              `INSERT INTO lead_followups (lead_id, tenant_id, title, description, due_at, assigned_to, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
              [lead.id, tenantId, title, (node.config.notes ?? node.config.description ?? '') as string, dueAt, assignTo, safeUserId]
            );
            if (!fuRes.rows[0]?.id) {
              status = 'failed'; message = 'create_followup: follow-up was not created in database';
            } else {
              message = `Follow-up: "${title}" in ${dueHours}h`;
              setImmediate(() => triggerWorkflows('follow_up', lead, tenantId, safeUserId ?? userId).catch(() => null));
            }
          } else {
            status = 'skipped';
            message = lead.id?.startsWith('test-')
              ? 'create_followup: test contact is not a real CRM lead — use a contact from CRM to test this action'
              : 'create_followup: no lead ID';
          }
          break;
        }

        // ── Internal Notification ──────────────────────────────────────────────
        case 'internal_notify': {
          const msg = interpolate((node.config.message ?? 'Workflow notification') as string, lead, valueTokens);
          const notifTitle = interpolate((node.config.actionName ?? 'Automation Notification') as string, lead, valueTokens);
          const sendTo = (node.config.sendTo ?? 'assigned') as string;

          let recipientIds: string[] = [];
          if (sendTo === 'specific' && node.config.staff_id) {
            recipientIds = [node.config.staff_id as string];
          } else if (sendTo === 'all') {
            // Fix 5: exclude owner; Fix 8: exclude the workflow trigger user
            const usersRes = await query(
              `SELECT id FROM users WHERE tenant_id=$1 AND is_active=TRUE AND is_owner IS NOT TRUE`,
              [tenantId]
            );
            recipientIds = usersRes.rows
              .map((u: any) => u.id)
              .filter((id: string) => id !== userId);
          } else if (sendTo === 'assigned' && lead.assigned_to) {
            recipientIds = [lead.assigned_to];
          }

          let notifFailed = 0;
          for (const uid of recipientIds) {
            const nRes = await query(
              `INSERT INTO notifications (tenant_id, user_id, title, message, type)
               VALUES ($1,$2,$3,$4,'automation') RETURNING id, created_at`,
              [tenantId, uid, notifTitle, msg]
            );
            if (!nRes.rows[0]?.id) {
              notifFailed++;
            } else {
              // Fix 3: emit real-time socket event so recipient sees it immediately
              emitToUser(uid, 'notification:new', {
                id:         nRes.rows[0].id,
                type:       'automation',
                title:      notifTitle,
                message:    msg,
                is_read:    false,
                created_at: nRes.rows[0].created_at,
              });
            }
          }
          if (recipientIds.length === 0) {
            status = 'skipped'; message = `internal_notify: no recipients found (sendTo=${sendTo})`;
          } else if (notifFailed > 0) {
            status = 'failed'; message = `internal_notify: ${notifFailed}/${recipientIds.length} notifications failed to insert`;
          } else {
            message = `Notified: ${recipientIds.length} recipient(s) · ${sendTo}`;
          }
          break;
        }

        // ── Webhook Call ───────────────────────────────────────────────────────
        case 'webhook_call': {
          const url = interpolate((node.config.url ?? '') as string, lead, valueTokens);
          if (!url) { status = 'skipped'; message = 'webhook_call: no URL configured'; break; }

          // ── Time-aware check ────────────────────────────────────────────────
          if (node.config.webhook_type === 'time_aware') {
            const now = new Date();
            const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()];
            const allowedDays: string[] = (node.config.time_days as string[]) ?? ['Mon','Tue','Wed','Thu','Fri'];
            if (!allowedDays.includes(dayName)) {
              status = 'skipped'; message = `webhook_call: skipped — ${dayName} not in allowed days`; break;
            }
            const hhmm = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
            const start = (node.config.time_start as string) ?? '09:00';
            const end   = (node.config.time_end   as string) ?? '18:00';
            if (hhmm < start || hhmm > end) {
              status = 'skipped'; message = `webhook_call: skipped — current time ${hhmm} outside window ${start}–${end}`; break;
            }
          }

          const method = ((node.config.method ?? 'POST') as string).toUpperCase();
          const requestFormat = (node.config.request_format as string) ?? 'json';
          const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);

          // ── Build headers ───────────────────────────────────────────────────
          const defaultContentType = requestFormat === 'form'
            ? 'application/x-www-form-urlencoded'
            : 'application/json';
          let headers: Record<string, string> = { 'Content-Type': defaultContentType };

          // New: header_fields array [{key,value}]
          const headerFields = node.config.header_fields as { key: string; value: string }[] | undefined;
          if (Array.isArray(headerFields) && headerFields.length > 0) {
            for (const hf of headerFields) {
              if (hf.key?.trim()) headers[hf.key.trim()] = interpolate(hf.value ?? '', lead, valueTokens);
            }
          } else if (node.config.headers) {
            // Legacy: raw JSON string
            try { headers = { ...headers, ...JSON.parse(interpolate(node.config.headers as string, lead, valueTokens)) }; }
            catch { /* ignore */ }
          }

          // ── Build body ──────────────────────────────────────────────────────
          let bodyStr: string | undefined;
          if (hasBody) {
            const bodyMode   = (node.config.body_mode as string) ?? 'fields';
            const bodyFields = node.config.body_fields as { key: string; value: string }[] | undefined;
            const rawPayload = (node.config.payload ?? node.config.body ?? '') as string;

            if (bodyMode === 'raw' && rawPayload) {
              // Raw JSON mode — parse template, interpolate each string value safely,
              // then re-serialize. This prevents special characters (quotes, backslashes)
              // in lead data from producing malformed JSON.
              try {
                const template = JSON.parse(rawPayload);
                const interp = (val: unknown): unknown => {
                  if (typeof val === 'string') return interpolate(val, lead, valueTokens);
                  if (Array.isArray(val)) return val.map(interp);
                  if (val !== null && typeof val === 'object') {
                    const out: Record<string, unknown> = {};
                    for (const [k, v] of Object.entries(val)) out[k] = interp(v);
                    return out;
                  }
                  return val;
                };
                bodyStr = JSON.stringify(interp(template));
              } catch {
                // Fallback: direct string interpolation if template is not valid JSON
                bodyStr = interpolate(rawPayload, lead, valueTokens);
              }
            } else if (Array.isArray(bodyFields) && bodyFields.length > 0) {
              // Field builder mode
              const obj: Record<string, string> = {};
              for (const bf of bodyFields) {
                if (bf.key?.trim()) obj[bf.key.trim()] = interpolate(bf.value ?? '', lead, valueTokens);
              }
              if (requestFormat === 'form') {
                bodyStr = new URLSearchParams(obj).toString();
              } else {
                bodyStr = JSON.stringify(obj);
              }
            } else {
              // Legacy: raw payload string, or default full-lead dump
              bodyStr = rawPayload
                ? interpolate(rawPayload, lead, valueTokens)
                : JSON.stringify({ lead, triggeredAt: new Date().toISOString() });
            }
          }

          const resp = await fetch(url, {
            method,
            headers,
            body: bodyStr,
            signal: AbortSignal.timeout(15000),
          });
          if (!resp.ok) throw new Error(`Webhook ${method} ${url} returned ${resp.status}`);

          // ── Save response to custom field ───────────────────────────────────
          if (node.config.save_response && node.config.save_response_field) {
            try {
              const respText = await resp.clone().text();
              let respVal: string;
              try { respVal = JSON.stringify(JSON.parse(respText)); } catch { respVal = respText.trim(); }
              const slug = node.config.save_response_field as string;
              const existing = (lead.custom_fields as Record<string, any>) ?? {};
              await query(
                `UPDATE leads SET custom_fields=$1, updated_at=NOW() WHERE id=$2::uuid AND tenant_id=$3::uuid`,
                [JSON.stringify({ ...existing, [slug]: respVal }), lead.id, tenantId]
              );
            } catch { /* don't fail the node if save fails */ }
          }

          message = `Webhook ${method} ${url} → ${resp.status}`;
          break;
        }

        // ── Send WhatsApp ──────────────────────────────────────────────────────
        // Leak 5 fix: actually send via WABA integration
        case 'send_whatsapp': {
          const toPhone = lead.phone;
          if (!toPhone) {
            status = 'skipped'; message = 'send_whatsapp: lead has no phone number'; break;
          }
          const wabaRes = await query(
            `SELECT phone_number_id, access_token FROM waba_integrations
             WHERE tenant_id=$1 AND is_active=TRUE LIMIT 1`,
            [tenantId]
          );
          if (!wabaRes.rows[0]) {
            throw new Error('send_whatsapp: WABA integration not configured or inactive — set it up under Integrations → WhatsApp');
          }
          const { phone_number_id, access_token: encToken } = wabaRes.rows[0];
          const waToken = decrypt(encToken);
          const msgText = interpolate(
            (node.config.message ?? node.config.template ?? '') as string, lead, valueTokens
          );
          if (!msgText) {
            status = 'skipped'; message = 'send_whatsapp: no message body configured'; break;
          }
          const waResp = await sendWAText(phone_number_id, waToken, toPhone, msgText);
          if (waResp?.error) {
            throw new Error(`WhatsApp API error (${waResp.error.code}): ${waResp.error.message}`);
          }
          const wamid = waResp?.messages?.[0]?.id ?? '';
          message = `WhatsApp sent to ${toPhone}${wamid ? ` (wamid: ${wamid})` : ''}`;
          break;
        }

        // ── Send Email ─────────────────────────────────────────────────────────
        case 'send_email': {
          const toEmail = interpolate((node.config.to ?? lead.email ?? '') as string, lead, valueTokens);
          const subject = interpolate((node.config.subject ?? 'Message from DigyGo') as string, lead, valueTokens);
          const body    = interpolate((node.config.body ?? node.config.message ?? '') as string, lead, valueTokens);

          if (!toEmail) {
            status = 'skipped'; message = 'send_email: no recipient email address';
          } else if (!isSmtpConfigured()) {
            status = 'skipped'; message = 'send_email: SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS in .env)';
          } else {
            // White-label: action's own replyTo/fromName win, else fall back to tenant identity
            const tIdent = await getTenantEmailIdentity(tenantId);
            const replyTo = (node.config.replyTo as string)?.trim() || tIdent.replyTo;
            const fromName = (node.config.fromName as string)?.trim() || tIdent.fromName;
            const { messageId } = await sendEmail({
              to:      toEmail,
              subject,
              html:    body.replace(/\n/g, '<br>'),
              text:    body,
              replyTo,
              fromName,
            });
            message = `Email sent to ${toEmail} (${messageId})`;
          }
          break;
        }

        // ── Send WhatsApp Personal (QR-based) ─────────────────────────────────
        case 'send_whatsapp_personal': {
          const toPhone = lead.phone;
          if (!toPhone) {
            status = 'skipped'; message = 'send_whatsapp_personal: lead has no phone number'; break;
          }
          const { sendText, sendMedia, getSession } = await import('../services/whatsapp/sessionManager');
          const { toJID } = await import('../services/whatsapp/phoneUtils');
          if (!getSession(tenantId)) {
            status = 'failed'; message = 'send_whatsapp_personal: WhatsApp Personal session not connected — scan QR under Integrations'; break;
          }

          let msgText = '';
          let filePath: string | null = null;
          let fileType: string | null = null;
          let fileName: string | null = null;

          if (node.config.templateId) {
            // Load from saved WA personal template
            const tmplRes = await query(
              `SELECT message, file_path, file_type, file_name FROM wa_personal_templates WHERE id=$1::uuid AND tenant_id=$2::uuid`,
              [node.config.templateId, tenantId],
            );
            if (!tmplRes.rows[0]) {
              status = 'failed'; message = 'send_whatsapp_personal: template not found'; break;
            }
            msgText  = interpolate(tmplRes.rows[0].message as string, lead, valueTokens);
            filePath = tmplRes.rows[0].file_path ?? null;
            fileType = tmplRes.rows[0].file_type ?? null;
            fileName = tmplRes.rows[0].file_name ?? null;
          } else {
            msgText = interpolate((node.config.message ?? '') as string, lead, valueTokens);
          }

          if (!msgText && !filePath) {
            status = 'skipped'; message = 'send_whatsapp_personal: no message or file configured'; break;
          }

          const jid = toJID(toPhone);
          if (filePath) {
            const fsMod  = await import('fs');
            const pathMod = await import('path');
            const fullPath = pathMod.resolve(process.cwd(), filePath);
            if (!fsMod.existsSync(fullPath)) {
              status = 'failed'; message = `send_whatsapp_personal: template file not found on disk`; break;
            }
            const buffer = fsMod.readFileSync(fullPath);
            await sendMedia(tenantId, jid, buffer, fileType ?? 'application/octet-stream', fileName ?? 'file', msgText || undefined);
          } else {
            await sendText(tenantId, jid, msgText);
          }

          await query(
            `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
             VALUES ($1::uuid, $2::uuid, 'whatsapp', 'WhatsApp sent (Personal via Automation)', $3, NULL)`,
            [lead.id, tenantId, (msgText || fileName || 'media').slice(0, 255)],
          ).catch(() => null);
          message = `WhatsApp Personal sent to ${toPhone}${filePath ? ' (with attachment)' : ''}`;
          break;
        }

        // ── Send SMS ───────────────────────────────────────────────────────────
        // Leak 5 fix: fail visibly so the gap shows in execution logs, not as a silent skip
        case 'send_sms': {
          throw new Error('SMS sending not implemented — integrate Twilio/MSG91 and set TWILIO_SID in env');
        }

        // ── Execute Another Automation ─────────────────────────────────────────
        case 'execute_automation': {
          const targetId = node.config.workflow_id as string;
          if (targetId && lead.id) {
            const targetRes = await query(
              `SELECT * FROM workflows WHERE id=$1::uuid AND tenant_id=$2::uuid AND status IN ('active','draft')`,
              [targetId, tenantId]
            );
            if (targetRes.rows[0]) {
              const subNodes: WFNode[] = targetRes.rows[0].nodes ?? [];
              // Create a dedicated execution record so sub-workflow logs are visible
              const subExecRes = await query(
                `INSERT INTO workflow_executions
                   (workflow_id, tenant_id, lead_id, lead_name, trigger_type, status, enrolled_at)
                 VALUES ($1,$2,$3,$4,'execute_automation','running',NOW()) RETURNING id`,
                [targetId, tenantId, lead.id, lead.name ?? null]
              ).catch(() => null);
              const subExecId = subExecRes?.rows[0]?.id ?? executionId;
              const subStats = await executeNodes(subNodes, lead, tenantId, userId, subExecId, targetId);
              await query(
                `UPDATE workflow_executions SET status=$1, completed_at=NOW() WHERE id=$2`,
                [subStats.failed > 0 ? 'failed' : 'completed', subExecId]
              ).catch(() => null);
              stats.skipped += subStats.skipped;
              stats.failed  += subStats.failed;
              message = `Sub-workflow executed: ${targetRes.rows[0].name}`;
            } else {
              status = 'skipped'; message = 'execute_automation: target workflow not found or not accessible';
            }
          } else {
            status = 'skipped'; message = 'execute_automation: no workflow_id configured';
          }
          break;
        }

        // ── Remove Workflow (remove contact from this workflow run) ────────────
        case 'remove_workflow': {
          message = 'Contact removed from workflow';
          await logStep(executionId, workflowId, tenantId, node, 'completed', message);
          stats.exit = true;
          return stats;
        }

        // ── Exit Workflow ──────────────────────────────────────────────────────
        case 'exit_workflow': {
          message = 'Workflow exited early';
          await logStep(executionId, workflowId, tenantId, node, 'completed', message);
          stats.exit = true;
          return stats;
        }

        // ── Pincode Routing ───────────────────────────────────────────────────
        case 'pincode_routing': {
          const fieldSlug  = ((node.config.pincode_field ?? 'pincode') as string).trim();
          const setId      = (node.config.set_id as string ?? '').trim();
          const matchType  = (node.config.match_type as string ?? 'exact');

          const fieldValue = String(
            (lead as any)[fieldSlug] ?? lead.custom_fields?.[fieldSlug] ?? ''
          ).trim();

          if (!fieldValue) {
            status = 'skipped';
            message = `field_routing: no value found for field "${fieldSlug}" on this lead`;
            break;
          }

          // ── Lookup: new field_routing_rows (if set_id set) or legacy pincode_district_map
          let matchRow: { district: string | null; state: string | null; pipeline_name: string | null; meta?: Record<string, any> | null; set_name?: string } | null = null;

          if (setId) {
            let lookupRes;
            if (matchType === 'contains') {
              lookupRes = await query(
                `SELECT frr.match_value, frr.pipeline_name, frr.district, frr.state, frr.meta, frs.name AS set_name
                 FROM field_routing_rows frr
                 JOIN field_routing_sets frs ON frs.id = frr.set_id
                 WHERE frr.set_id=$1::uuid AND frr.tenant_id=$2::uuid
                   AND (LOWER($3) LIKE '%' || LOWER(frr.match_value) || '%'
                     OR LOWER(frr.match_value) LIKE '%' || LOWER($3) || '%')
                 ORDER BY length(frr.match_value) DESC LIMIT 1`,
                [setId, tenantId, fieldValue]
              ).catch(() => ({ rows: [] as any[] }));
            } else {
              lookupRes = await query(
                `SELECT frr.match_value, frr.pipeline_name, frr.district, frr.state, frr.meta, frs.name AS set_name
                 FROM field_routing_rows frr
                 JOIN field_routing_sets frs ON frs.id = frr.set_id
                 WHERE frr.set_id=$1::uuid AND frr.tenant_id=$2::uuid AND LOWER(frr.match_value)=LOWER($3)`,
                [setId, tenantId, fieldValue]
              ).catch(() => ({ rows: [] as any[] }));
            }
            if (lookupRes.rows[0]) {
              matchRow = lookupRes.rows[0];
              await query(
                `UPDATE field_routing_sets SET times_used=times_used+1, updated_at=NOW() WHERE id=$1::uuid`,
                [setId]
              ).catch(() => null);
            }
          } else {
            // Legacy: pincode_district_map
            const legacyRes = await query(
              `SELECT district, state, pipeline_name FROM pincode_district_map WHERE tenant_id=$1 AND pincode=$2`,
              [tenantId, fieldValue]
            ).catch(() => ({ rows: [] as any[] }));
            if (legacyRes.rows[0]) matchRow = legacyRes.rows[0];
          }

          // ── No match: try fallback pipeline
          if (!matchRow) {
            const fallbackPipelineId = (node.config.fallback_enabled && node.config.fallback_pipeline_id)
              ? (node.config.fallback_pipeline_id as string) : null;

            if (fallbackPipelineId && lead.id) {
              const fbRes = await query(
                `SELECT p.id AS pipeline_id, ps.id AS stage_id, ps.name AS stage_name, p.name AS pipeline_name
                 FROM pipelines p JOIN pipeline_stages ps ON ps.pipeline_id=p.id
                 WHERE p.id=$1 AND p.tenant_id=$2 ORDER BY ps.stage_order ASC NULLS LAST LIMIT 1`,
                [fallbackPipelineId, tenantId]
              ).catch(() => ({ rows: [] as any[] }));
              if (fbRes.rows[0]) {
                const { pipeline_id, stage_id, stage_name, pipeline_name: fbName } = fbRes.rows[0];
                const fbMove = await query(
                  `UPDATE leads SET pipeline_id=$1, stage_id=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4`,
                  [pipeline_id, stage_id, lead.id, tenantId]
                );
                if ((fbMove.rowCount ?? 0) > 0) {
                  lead.pipeline_id = pipeline_id; lead.stage_id = stage_id;
                  lead.pipeline_name = fbName; lead.stage_name = stage_name;
                  const updFb = await query(
                    `SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id=l.assigned_to WHERE l.id=$1`,
                    [lead.id]
                  ).catch(() => ({ rows: [] as any[] }));
                  if (updFb.rows[0]) emitToTenant(tenantId, 'lead:updated', updFb.rows[0]);
                  message = `field_routing: "${fieldValue}" not in mapping — moved to fallback pipeline "${fbName}" (Stage: ${stage_name})`;
                } else {
                  status = 'failed';
                  message = `field_routing: "${fieldValue}" not in mapping — fallback pipeline move affected 0 rows`;
                }
              } else {
                status = 'failed';
                message = `field_routing: "${fieldValue}" not in mapping — fallback pipeline not found`;
              }
            } else {
              status = 'skipped';
              message = `field_routing: "${fieldValue}" not found in mapping${setId ? ` (set: ${setId})` : ''} — no fallback configured`;
            }
            break;
          }

          const { district, state, pipeline_name, set_name } = matchRow;
          const metaFields: Record<string, string> = {};
          if (matchRow.meta && typeof matchRow.meta === 'object') {
            for (const [k, v] of Object.entries(matchRow.meta)) {
              const val = String(v ?? '').trim();
              if (k && val) metaFields[k] = val;
            }
          }

          // Legacy district/state → custom_fields JSONB only (UNCHANGED behavior).
          if (lead.id && district) {
            const dsPatch: Record<string, string> = { district };
            if (state) dsPatch.state = state;
            await query(
              `UPDATE leads SET custom_fields=custom_fields || $1::jsonb, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`,
              [JSON.stringify(dsPatch), lead.id, tenantId]
            ).catch(() => null);
            if (!lead.custom_fields) lead.custom_fields = {};
            lead.custom_fields['district'] = district;
            if (state) lead.custom_fields['state'] = state;
          }

          // NEW: named meta fields → custom_fields JSONB + lead_field_values.
          // Only runs when a set actually has meta, so existing routing sets are untouched.
          if (lead.id && Object.keys(metaFields).length) {
            await query(
              `UPDATE leads SET custom_fields=COALESCE(custom_fields,'{}'::jsonb) || $1::jsonb, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`,
              [JSON.stringify(metaFields), lead.id, tenantId]
            ).catch(() => null);
            if (!lead.custom_fields) lead.custom_fields = {};
            Object.assign(lead.custom_fields, metaFields);
            setImmediate(() => backfillCustomFields(lead.id!, tenantId, metaFields).catch(() => null));
          }

          // Move lead to mapped pipeline (first stage)
          const effectivePipeline = (pipeline_name || district || '').trim();
          if (!effectivePipeline) {
            status = 'failed';
            message = `field_routing: "${fieldValue}" matched but no pipeline configured in this row`;
            break;
          }

          const pipeRes = await query(
            `SELECT p.id AS pipeline_id, ps.id AS stage_id, ps.name AS stage_name
             FROM pipelines p JOIN pipeline_stages ps ON ps.pipeline_id=p.id
             WHERE p.tenant_id=$1 AND LOWER(p.name)=LOWER($2)
             ORDER BY ps.stage_order ASC NULLS LAST LIMIT 1`,
            [tenantId, effectivePipeline]
          ).catch(() => ({ rows: [] as any[] }));

          if (pipeRes.rows[0]) {
            const { pipeline_id, stage_id, stage_name } = pipeRes.rows[0];
            if (!lead.id) { status = 'failed'; message = `field_routing: lead has no id`; break; }
            const moveRes = await query(
              `UPDATE leads SET pipeline_id=$1, stage_id=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4`,
              [pipeline_id, stage_id, lead.id, tenantId]
            );
            if ((moveRes.rowCount ?? 0) === 0) {
              status = 'failed';
              message = `field_routing: UPDATE affected 0 rows — lead not moved to pipeline "${effectivePipeline}"`;
              break;
            }
            lead.pipeline_id = pipeline_id; lead.stage_id = stage_id; lead.stage_name = stage_name;
            lead.pipeline_name = effectivePipeline;
            const updatedLead = await query(
              `SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id=l.assigned_to WHERE l.id=$1`,
              [lead.id]
            ).catch(() => ({ rows: [] as any[] }));
            if (updatedLead.rows[0]) emitToTenant(tenantId, 'lead:updated', updatedLead.rows[0]);

            if (node.config.auto_tag && district) {
              await query(
                `UPDATE leads SET tags=array_append(tags,$1::text), updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND NOT ($1=ANY(tags))`,
                [district, lead.id, tenantId]
              ).catch(() => null);
              await syncTagToJunction(tenantId, lead.id, district).catch(() => null);
              if (!Array.isArray(lead.tags)) lead.tags = [];
              if (!lead.tags.includes(district)) lead.tags.push(district);
            }
            const setLabel = set_name ? ` [Set: ${set_name}]` : '';
            message = `field_routing${setLabel}: "${fieldValue}" → ${district ?? effectivePipeline}${state ? ', ' + state : ''} → Pipeline: ${effectivePipeline} (Stage: ${stage_name})${node.config.auto_tag && district ? ` · tagged "${district}"` : ''}`;
          } else {
            status = 'failed';
            message = `field_routing: pipeline "${effectivePipeline}" not found — ${district ? `district "${district}" set on lead but ` : ''}not moved`;
            if (lead.id) {
              await query(
                `INSERT INTO lead_notes (lead_id, tenant_id, title, content) VALUES ($1,$2,$3,$4)`,
                [lead.id, tenantId, `Field routing: no pipeline found`,
                 `Value "${fieldValue}" maps to pipeline "${effectivePipeline}" but it does not exist. Create it or update your routing set.`]
              ).catch(() => null);
            }
          }
          break;
        }

        // ── If / Else Condition ────────────────────────────────────────────────
        case 'if_else': {
          // Support both legacy single-condition and new multi-condition (conditions array)
          interface Condition { field: string; operator: string; value: string }

          const evalOne = (cond: Condition): boolean => {
            // Map frontend field names → actual lead object keys
            // pipeline/stage/staff dropdowns now store IDs, so compare against ID columns
            const fieldMap: Record<string, string> = {
              pipeline:       'pipeline_id',
              pipeline_stage: 'stage_id',
              assigned_staff: 'assigned_to',
            };
            const resolvedField = fieldMap[cond.field] ?? cond.field;

            // Special case: tag membership check (lead.tags is an array)
            if (cond.field === 'tag') {
              const tagsArr: string[] = Array.isArray((lead as any).tags) ? (lead as any).tags : [];
              const tagVal = (cond.value ?? '').toLowerCase().trim();
              switch ((cond.operator ?? 'equals').replace(/_/g, ' ')) {
                case 'equals':       return tagsArr.some((t) => t.toLowerCase() === tagVal);
                case 'not equals':   return !tagsArr.some((t) => t.toLowerCase() === tagVal);
                case 'contains':     return tagsArr.some((t) => t.toLowerCase().includes(tagVal));
                case 'not contains': return !tagsArr.some((t) => t.toLowerCase().includes(tagVal));
                case 'is empty':     return tagsArr.length === 0;
                case 'is not empty': return tagsArr.length > 0;
                default:             return false;
              }
            }

            // Leak 6 fix: check top-level fields first, then custom_fields by slug
            const rawLeadVal = String(
              (lead as any)[resolvedField] ?? lead.custom_fields?.[cond.field] ?? ''
            );
            const leadVal = rawLeadVal.toLowerCase().trim();
            const val = (cond.value ?? '').toLowerCase().trim();
            switch ((cond.operator ?? 'equals').replace(/_/g, ' ')) {
              case 'equals':       return leadVal === val;
              case 'not equals':   return leadVal !== val;
              case 'contains':     return leadVal.includes(val);
              case 'not contains': return !leadVal.includes(val);
              case 'starts with':  return leadVal.startsWith(val);
              case 'ends with':    return leadVal.endsWith(val);
              case 'is empty':     return leadVal === '';
              case 'is not empty': return leadVal !== '';
              case 'greater than': return parseFloat(rawLeadVal) > parseFloat(val);
              case 'less than':    return parseFloat(rawLeadVal) < parseFloat(val);
              default:             return false;
            }
          };

          let conditionMet: boolean;
          const conditions = node.config.conditions as Condition[] | undefined;
          if (conditions && conditions.length > 0) {
            const logic = (node.config.logic ?? 'AND') as string;
            conditionMet = logic === 'OR'
              ? conditions.some(evalOne)
              : conditions.every(evalOne);
            message = `Condition [${logic} of ${conditions.length}] → ${conditionMet ? 'YES' : 'NO'}`;
          } else {
            // Legacy single-condition — skip if no field configured
            const legacyField = (node.config.field ?? '') as string;
            if (!legacyField) {
              status = 'skipped'; message = 'if_else: no condition configured'; break;
            }
            conditionMet = evalOne({
              field:    legacyField,
              operator: (node.config.operator ?? 'equals') as string,
              value:    (node.config.value    ?? '') as string,
            });
            message = `Condition [${node.config.field} ${node.config.operator} "${node.config.value}"] → ${conditionMet ? 'YES' : 'NO'}`;
          }

          const branch = conditionMet ? node.branches?.yes : node.branches?.no;
          if (branch?.length) {
            const branchStats = await executeNodes(branch, lead, tenantId, userId, executionId, workflowId);
            stats.skipped += branchStats.skipped;
            stats.failed  += branchStats.failed;
            if (branchStats.exit) { stats.exit = true; }
          }
          break;
        }

        // ── Time Delay ─────────────────────────────────────────────────────────
        case 'delay': {
          // Resolve delay in minutes — supports preset format + legacy delayAmount/delayUnit
          let delayMinutes = 1440;
          const preset = node.config.preset as string | undefined;
          if (preset && preset !== 'custom') {
            const presetMap: Record<string, number> = {
              '24h': 1440, '12h': 720, '4h': 240, '60m': 60, '30m': 30, '15m': 15, '5m': 5,
            };
            delayMinutes = presetMap[preset] ?? 1440;
          } else if (preset === 'custom') {
            const val  = parseFloat((node.config.customValue ?? '1') as string) || 1;
            const unit = (node.config.customUnit ?? 'hours') as string;
            delayMinutes = unit === 'minutes' ? val : unit === 'days' ? val * 1440 : val * 60;
          } else {
            // Legacy format: delayAmount + delayUnit
            const amount = parseFloat((node.config.delayAmount ?? node.config.delay_amount ?? '1') as string) || 1;
            const unit   = (node.config.delayUnit ?? node.config.delay_unit ?? 'hours') as string;
            delayMinutes = unit === 'minutes' ? amount : unit === 'days' ? amount * 1440 : amount * 60;
          }

          let runAt = new Date(Date.now() + delayMinutes * 60_000);

          // Advanced Time Window: push run_at into the next allowed window if needed
          if (node.config.useAdvancedWindow) {
            const winStart = (node.config.windowStart as string) ?? '09:00';
            const winEnd   = (node.config.windowEnd   as string) ?? '18:00';
            const winDays  = (node.config.windowDays  as string[]) ?? ['mon','tue','wed','thu','fri'];
            runAt = adjustToTimeWindow(runAt, winStart, winEnd, winDays);
          }

          const runAtIso = runAt.toISOString();
          const nodeIdx  = nodes.indexOf(node);
          const remaining = nodes.slice(nodeIdx + 1);

          if (remaining.length > 0) {
            const leadIdForQueue = (lead.id && !lead.id.startsWith('test-')) ? lead.id : null;
            await query(
              `INSERT INTO scheduled_workflow_steps
                 (workflow_id, execution_id, tenant_id, lead_id, lead_data, remaining_nodes, run_at, step_index)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [workflowId, executionId, tenantId, leadIdForQueue, JSON.stringify(lead), JSON.stringify(remaining), runAtIso, nodeIdx]
            );
            message = `Delay scheduled: ${delayMinutes}m — ${remaining.length} step(s) queued for ${runAtIso}`;
          } else {
            message = `Delay of ${delayMinutes}m (no further steps after delay)`;
          }
          // Stop processing remaining nodes inline — the worker will resume
          await logStep(executionId, workflowId, tenantId, node, 'completed', message);
          return stats;
        }

        // ── API Request (configurable HTTP method, headers, body) ─────────────
        case 'api_call': {
          const url    = interpolate((node.config.url    ?? '') as string, lead, valueTokens);
          const method = ((node.config.method ?? 'GET') as string).toUpperCase();

          if (!url) { status = 'skipped'; message = 'api_call: no URL configured'; break; }

          let headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (node.config.headers) {
            try { headers = { ...headers, ...JSON.parse(interpolate(node.config.headers as string, lead, valueTokens)) }; }
            catch { /* ignore malformed headers JSON */ }
          }

          const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
          let bodyStr: string | undefined;
          if (hasBody) {
            const rawBody = (node.config.body ?? node.config.payload ?? '') as string;
            bodyStr = rawBody ? interpolate(rawBody, lead, valueTokens) : JSON.stringify({ lead, triggeredAt: new Date().toISOString() });
          }

          const resp = await fetch(url, {
            method,
            headers,
            body: bodyStr,
            signal: AbortSignal.timeout(15000),
          });

          let responseText = '';
          try { responseText = await resp.text(); } catch { /* ignore */ }
          if (!resp.ok) throw new Error(`API request ${method} ${url} returned ${resp.status}: ${responseText.slice(0, 200)}`);
          message = `API ${method} ${url} → ${resp.status}`;

          if (node.config.saveResponse && lead.id) {
            const truncated = responseText.slice(0, 2000);
            await query(
              `UPDATE leads SET custom_fields = COALESCE(custom_fields,'{}')::jsonb || $1::jsonb, updated_at=NOW()
               WHERE id=$2 AND tenant_id=$3`,
              [JSON.stringify({ last_api_response: truncated }), lead.id, tenantId]
            );
          }
          break;
        }

        // ── Change Appointment Status ──────────────────────────────────────────
        case 'change_appointment': {
          const apptStatus = (node.config.status ?? node.config.appointmentStatus ?? '') as string;
          if (!apptStatus) { status = 'skipped'; message = 'change_appointment: no status configured'; break; }

          const statusMap: Record<string, string> = {
            'Booked':      'booked',
            'Cancelled':   'cancelled',
            'Completed':   'completed',
            'No Show':     'noshow',
            'Rescheduled': 'rescheduled',
          };
          const dbStatus = statusMap[apptStatus] ?? apptStatus.toLowerCase();

          if (lead.id) {
            const apptRes = await query(
              `SELECT id FROM calendar_events WHERE lead_id=$1 AND tenant_id=$2 ORDER BY start_time DESC LIMIT 1`,
              [lead.id, tenantId]
            );
            if (apptRes.rows[0]) {
              await query(
                `UPDATE calendar_events SET status=$1, updated_at=NOW() WHERE id=$2`,
                [dbStatus, apptRes.rows[0].id]
              );
              const vAppt = await query('SELECT status FROM calendar_events WHERE id=$1', [apptRes.rows[0].id]);
              if (vAppt.rows[0]?.status !== dbStatus) {
                status = 'failed'; message = `change_appointment: status not updated (got ${vAppt.rows[0]?.status})`;
              } else {
                message = `Appointment: ${dbStatus}`;
              }
            } else {
              status = 'skipped'; message = 'change_appointment: no appointment found for this lead';
            }
          } else {
            status = 'skipped'; message = 'change_appointment: no lead ID';
          }
          break;
        }

        // ── Contact Group (add/remove/move via real contact_group_members table) ─
        case 'contact_group': {
          const groupAction = (node.config.groupAction ?? 'add') as string;
          const groupId     = (node.config.group_id ?? '') as string;
          if (!groupId) {
            if (node.config.targetList) {
              status = 'failed'; message = 'contact_group: action needs reconfiguration — open this node and select a Contact Group from the dropdown';
            } else {
              status = 'skipped'; message = 'contact_group: no group configured — open the action node and select a group';
            }
            break;
          }
          if (!lead.id) { status = 'skipped'; message = 'contact_group: no lead ID'; break; }

          const grpCheck = await query(
            `SELECT id, name FROM contact_groups WHERE id=$1::uuid AND tenant_id=$2::uuid`,
            [groupId, tenantId]
          );
          if (!grpCheck.rows[0]) { status = 'skipped'; message = 'contact_group: group not found or belongs to another tenant'; break; }
          const grpLabel = grpCheck.rows[0].name as string;

          if (groupAction === 'remove') {
            await query(
              `DELETE FROM contact_group_members WHERE group_id=$1::uuid AND lead_id=$2::uuid`,
              [groupId, lead.id]
            );
            message = `Removed from group: ${grpLabel}`;
          } else if (groupAction === 'move') {
            const sourceGroupId = (node.config.source_group_id ?? '') as string;
            if (sourceGroupId) {
              await query(
                `DELETE FROM contact_group_members WHERE group_id=$1::uuid AND lead_id=$2::uuid`,
                [sourceGroupId, lead.id]
              );
            } else {
              await query(
                `DELETE FROM contact_group_members
                 WHERE lead_id=$1::uuid
                   AND group_id IN (SELECT id FROM contact_groups WHERE tenant_id=$2::uuid)`,
                [lead.id, tenantId]
              );
            }
            await query(
              `INSERT INTO contact_group_members (group_id, lead_id, added_by)
               VALUES ($1::uuid, $2::uuid, 'workflow') ON CONFLICT DO NOTHING`,
              [groupId, lead.id]
            );
            message = `Moved to group: ${grpLabel}`;
            setImmediate(() =>
              triggerWorkflows('contact_group_added', lead, tenantId, safeUserId ?? userId, {
                triggerContext: { group_id: groupId },
              }).catch(() => null)
            );
          } else {
            // add
            const r = await query(
              `INSERT INTO contact_group_members (group_id, lead_id, added_by)
               VALUES ($1::uuid, $2::uuid, 'workflow') ON CONFLICT (group_id, lead_id) DO NOTHING`,
              [groupId, lead.id]
            );
            if ((r.rowCount ?? 0) > 0) {
              message = `Added to group: ${grpLabel}`;
              setImmediate(() =>
                triggerWorkflows('contact_group_added', lead, tenantId, safeUserId ?? userId, {
                  triggerContext: { group_id: groupId },
                }).catch(() => null)
              );
            } else {
              message = `Already in group: ${grpLabel} (skipped)`;
            }
          }
          break;
        }

        // ── Contact Group Access (deprecated — no-op) ──────────────────────────
        case 'contact_group_access': {
          status = 'skipped';
          message = 'contact_group_access: deprecated — replace with the Contact Group action';
          break;
        }

        // ── Assign To AI Agent ─────────────────────────────────────────────────
        case 'assign_ai': {
          const agentId = (node.config.agentId ?? node.config.agent ?? '') as string;
          if (!agentId) { status = 'skipped'; message = 'assign_ai: no AI agent configured'; break; }
          if (lead.id) {
            await query(
              `UPDATE leads SET custom_fields = COALESCE(custom_fields,'{}')::jsonb || $1::jsonb, updated_at=NOW()
               WHERE id=$2 AND tenant_id=$3`,
              [JSON.stringify({ ai_agent_id: agentId, ai_assigned_at: new Date().toISOString() }), lead.id, tenantId]
            );
            message = `AI agent assigned: ${agentId} (stored in custom_fields.ai_agent_id)`;
          }
          break;
        }

        // ── Event Start Time (informational, marks contact as event-aware) ─────
        case 'event_start_time': {
          const eventTime = (node.config.eventTime ?? '') as string;
          if (lead.id) {
            await query(
              `UPDATE leads SET custom_fields = COALESCE(custom_fields,'{}')::jsonb || $1::jsonb, updated_at=NOW()
               WHERE id=$2 AND tenant_id=$3`,
              [JSON.stringify({ event_start_time: eventTime || new Date().toISOString() }), lead.id, tenantId]
            );
            message = `Event start time recorded: ${eventTime || 'now'}`;
          } else {
            status = 'skipped'; message = 'event_start_time: no lead ID';
          }
          break;
        }

        // ── Instagram DM (requires Meta API — not yet implemented) ───────────
        // Leak 5 fix: throw so execution shows as 'failed', not silently 'skipped'
        case 'post_instagram': {
          throw new Error('Instagram DM not implemented — wire Meta Messenger API to enable this action');
        }

        // ── Facebook Comment Reply (requires Meta API — not yet implemented) ──
        case 'facebook_post': {
          throw new Error('Facebook comment reply not implemented — wire Meta Graph API to enable this action');
        }

        default: {
          status = 'skipped';
          message = `Action "${node.actionType}" is not implemented yet`;
        }
      }
    } catch (err: any) {
      status = 'failed';
      message = err.message ?? 'Execution error';
    }

    if (status === 'skipped') stats.skipped++;
    if (status === 'failed') stats.failed++;
    await logStep(executionId, workflowId, tenantId, node, status, message);
    if (stats.exit) return stats;

    // Mirror key automation actions to lead_activities so they appear in the Activity Timeline
    if (status === 'completed' && lead.id && !lead.id.startsWith('test-')) {
      let actType: string | null = null;
      let actTitle = '';
      let actDetail: string | null = null;
      if (node.actionType === 'change_stage') {
        actType = 'stage_change';
        actTitle = message; // "Stage changed and verified: Stage Name"
      } else if (node.actionType === 'add_to_crm') {
        actType = 'stage_change';
        actTitle = message;
      } else if (node.actionType === 'assign_staff') {
        actType = 'assigned';
        actTitle = message; // "Assigned and verified: Staff Name"
      } else if (node.actionType === 'add_tag' || node.actionType === 'tag_contact') {
        actType = 'tag_added';
        actTitle = message; // "Tags added and verified: tag1, tag2"
      } else if (node.actionType === 'create_note') {
        actType = 'note';
        actTitle = 'Workflow note added';
        actDetail = message.replace('Note: ', '');
      } else if (node.actionType === 'create_followup') {
        actType = 'followup';
        actTitle = message;
      }
      if (actType) {
        await query(
          `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [lead.id, tenantId, actType, actTitle, actDetail, null]
        ).catch(() => null);
      }
    }
  }
  return stats;
}

// ── Enrich lead context with names for variable substitution ─────────────────

export async function enrichLead(lead: LeadContext): Promise<LeadContext> {
  const enriched = { ...lead };
  // Fetch full lead row when only id is available (e.g., notes_added / follow_up triggers)
  if (lead.id && !lead.name) {
    const r = await query(
      `SELECT name, email, phone, stage_id, pipeline_id, assigned_to, tags, source, meta_form_id, created_at
       FROM leads WHERE id=$1 AND is_deleted=FALSE LIMIT 1`,
      [lead.id]
    ).catch(() => ({ rows: [] }));
    if (r.rows[0]) {
      Object.assign(enriched, r.rows[0]);
      if (r.rows[0].meta_form_id && !enriched.form_id) enriched.form_id = r.rows[0].meta_form_id;
    }
  }
  // Always back-fill form_id from meta_form_id if still missing
  if (!enriched.form_id && (enriched as any).meta_form_id) {
    enriched.form_id = (enriched as any).meta_form_id;
  }
  // Fetch created_at if missing
  if (lead.id && !enriched.created_at) {
    const r = await query('SELECT created_at FROM leads WHERE id=$1 LIMIT 1', [lead.id]).catch(() => ({ rows: [] }));
    if (r.rows[0]?.created_at) enriched.created_at = r.rows[0].created_at;
  }
  // Fetch form_name from meta_forms if form_id is known but name is missing
  if (!enriched.form_name && enriched.form_id) {
    const r = await query(
      `SELECT form_name FROM meta_forms WHERE form_id=$1 LIMIT 1`,
      [enriched.form_id]
    ).catch(() => ({ rows: [] }));
    enriched.form_name = r.rows[0]?.form_name ?? '';
  }
  if (enriched.assigned_to && (!enriched.assigned_staff_name || !enriched.assigned_staff_id)) {
    const r = await query('SELECT name, staff_id FROM users WHERE id=$1', [enriched.assigned_to]);
    enriched.assigned_staff_name = r.rows[0]?.name ?? '';
    enriched.assigned_staff_id   = r.rows[0]?.staff_id ?? '';
  }
  if (enriched.pipeline_id && !enriched.pipeline_name) {
    const r = await query('SELECT name FROM pipelines WHERE id=$1', [enriched.pipeline_id]);
    enriched.pipeline_name = r.rows[0]?.name ?? '';
  }
  if (enriched.stage_id && !enriched.stage_name) {
    const r = await query('SELECT name FROM pipeline_stages WHERE id=$1', [enriched.stage_id]);
    enriched.stage_name = r.rows[0]?.name ?? '';
  }
  // Derive first_name / last_name from full name so if_else conditions can match on them
  if (enriched.name) {
    const parts = enriched.name.trim().split(/\s+/);
    (enriched as any).first_name = parts[0] ?? '';
    (enriched as any).last_name  = parts.length > 1 ? parts.slice(1).join(' ') : '';
  }

  // Fetch custom field values so if_else conditions can evaluate them
  if (lead.id) {
    const [cfRes, jsonbRes] = await Promise.all([
      // Structured custom fields stored in lead_field_values
      query(
        `SELECT cf.slug, lfv.value
         FROM lead_field_values lfv
         JOIN custom_fields cf ON cf.id = lfv.field_id
         WHERE lfv.lead_id = $1`,
        [lead.id]
      ).catch(() => ({ rows: [] })),
      // Flat JSONB custom_fields column (stores lead_quality, city, and any mapped values)
      query(
        `SELECT custom_fields FROM leads WHERE id=$1 LIMIT 1`,
        [lead.id]
      ).catch(() => ({ rows: [] })),
    ]);
    enriched.custom_fields = {};
    // Merge JSONB column first (lower priority)
    const jsonbFields: Record<string, string> = jsonbRes.rows[0]?.custom_fields ?? {};
    for (const [k, v] of Object.entries(jsonbFields)) {
      if (v !== null && v !== undefined) enriched.custom_fields[k] = String(v);
    }
    // lead_field_values override (higher priority — structured data)
    for (const row of cfRes.rows) {
      enriched.custom_fields[row.slug] = row.value;
    }
    // Expose lead_quality as a top-level key for direct comparison
    if (enriched.custom_fields['lead_quality']) {
      (enriched as any).lead_quality = enriched.custom_fields['lead_quality'];
    }
  }
  return enriched;
}

// ── Public trigger entry point ────────────────────────────────────────────────

export interface TriggerContext {
  followupType?: string;   // for follow_up trigger
  assignedTo?:   string;   // for follow_up trigger (staff ID)
  source?:       string;   // for contact_created trigger
  fieldChanged?: string;   // for contact_updated trigger
  tag?:          string;   // for contact_tagged trigger
  channel?:      string;   // for inbox_message trigger (e.g. 'whatsapp')
  messageBody?:  string;   // for inbox_message keyword matching
  apptType?:     string;   // for appointment_* triggers (event type name)
  calendarId?:   string;   // for calendar_form_submitted (booking_link.id)
  group_id?:     string;   // for contact_group_added trigger
  callDirection?: string;  // for call_answered / call_missed (INBOUND|OUTBOUND)
  configId?:     string;  // for sheets_row_added (google_sheets_configs.id)
}

export async function triggerWorkflows(
  triggerType: string,
  lead: LeadContext,
  tenantId: string,
  userId: string,
  options?: { forceReEntry?: boolean; triggerContext?: TriggerContext; workflowId?: string }
): Promise<void> {
  try {
    const enrichedLead = await enrichLead(lead);

    // Exact match only — each trigger type fires only its own workflows.
    // No cross-matching between meta_form, opt_in_form, lead_created etc.
    const matchingKeys = [triggerType];

    const formId   = enrichedLead.form_id   ?? '';
    const formName = enrichedLead.form_name ?? '';

    // Targeted query — only fetch workflows whose trigger matches AND whose form
    // filter either (a) is empty/not set (fires for any form) or (b) includes
    // the submitted form's ID or name.
    // For non-form triggers (lead_created, stage_changed, etc.) the trigger_forms
    // filter is irrelevant and must be bypassed so stale form configs don't block them.
    // product_enquired also requires a form to be configured — blank = inactive
    const isFormTrigger = triggerType === 'opt_in_form' || triggerType === 'meta_form' || triggerType === 'product_enquired';
    // workflowId filter: when set (push-automation "Run Workflow"), scope to that one workflow only
    const workflowIdFilter = options?.workflowId ?? null;
    const result = await query(
      `SELECT * FROM workflows
       WHERE tenant_id = $1
         AND status    = 'active'
         AND trigger_key = ANY($2::text[])
         AND (
           -- Non-form triggers ignore the form filter entirely
           $5 = false
           -- Form triggers: must have at least one form configured AND it must match
           -- Blank trigger_forms = workflow is effectively inactive — never fires
           OR ($5 = true AND ($3 = ANY(trigger_forms) OR $4 = ANY(trigger_forms)))
         )
         AND ($6::uuid IS NULL OR id = $6::uuid)`,
      [tenantId, matchingKeys, formId, formName, isFormTrigger, workflowIdFilter]
    );

    console.log(`[WF] trigger="${triggerType}" form="${formName || formId || '-'}" → ${result.rows.length} matching workflow(s)`);
    const ctx = options?.triggerContext ?? {};
    for (const wf of result.rows) {
      const nodes: WFNode[] = Array.isArray(wf.nodes) ? wf.nodes : (typeof wf.nodes === 'string' ? JSON.parse(wf.nodes) : []);
      const triggerNode = nodes.find((n: WFNode) => n.type === 'trigger');
      if (!triggerNode) continue;

      // ── max_contacts cap ──────────────────────────────────────────────────
      if (wf.max_contacts && (wf.total_contacts ?? 0) >= wf.max_contacts) continue;

      // ── Unified trigger filter enforcement ────────────────────────────────
      // Each trigger type checks its own node config against the context that
      // was passed at the call site. Blank config = "any" (no filter).

      if (triggerType === 'stage_changed' || triggerType === 'lead_created') {
        const cfgPipeline = triggerNode.config?.pipeline_id as string;
        const cfgStage    = triggerNode.config?.stage_id    as string;
        if (cfgPipeline && cfgPipeline !== enrichedLead.pipeline_id) continue;
        if (cfgStage    && cfgStage    !== enrichedLead.stage_id)    continue;
      }

      if (triggerType === 'follow_up') {
        const cfgType  = (triggerNode.config?.followupType as string) ?? '';
        const cfgStaff = (triggerNode.config?.assignedTo   as string) ?? '';
        if (cfgType  && cfgType  !== (ctx.followupType ?? '')) continue;
        if (cfgStaff && cfgStaff !== (ctx.assignedTo   ?? '')) continue;
      }

      if (triggerType === 'contact_created') {
        const cfgSource = (triggerNode.config?.source as string) ?? '';
        if (cfgSource && cfgSource !== (ctx.source ?? '')) continue;
      }

      if (triggerType === 'contact_group_added') {
        const cfgGroupId = (triggerNode.config?.group_id as string) ?? '';
        // blank = fires for any group; set = only fires for that specific group
        if (cfgGroupId && cfgGroupId !== (ctx.group_id ?? '')) continue;
      }

      if (triggerType === 'contact_updated') {
        const cfgField = (triggerNode.config?.fieldChanged as string) ?? '';
        if (cfgField && cfgField !== (ctx.fieldChanged ?? '')) continue;
      }

      if (triggerType === 'contact_tagged') {
        // Support cfg.tags (new multi-tag array) and cfg.tag (old single-tag string)
        const cfgTags: string[] = Array.isArray(triggerNode.config?.tags)
          ? (triggerNode.config!.tags as string[])
          : (triggerNode.config?.tag as string) ? [(triggerNode.config!.tag as string)] : [];
        // No tags configured = workflow is inactive (never fires) — same rule as form triggers.
        // Empty means the user hasn't finished setting up the trigger.
        if (cfgTags.length === 0) continue;
        if (!cfgTags.includes(ctx.tag ?? '')) continue;
      }

      if (['appointment_booked','appointment_cancelled','appointment_rescheduled',
           'appointment_noshow','appointment_showup'].includes(triggerType)) {
        const cfgCalendars = (triggerNode.config?.calendars as string[]) ?? [];
        if (cfgCalendars.length > 0 && !cfgCalendars.includes(ctx.calendarId ?? '')) continue;
      }

      if (triggerType === 'inbox_message') {
        const cfgChannel = (triggerNode.config?.channel  as string) ?? '';
        const cfgKeyword = (triggerNode.config?.keyword  as string) ?? '';
        if (cfgChannel && cfgChannel !== (ctx.channel ?? '')) continue;
        if (cfgKeyword && !(ctx.messageBody ?? '').toLowerCase().includes(cfgKeyword.toLowerCase())) continue;
      }

      if (triggerType === 'call_answered' || triggerType === 'call_missed') {
        const cfgDirection = (triggerNode.config?.direction as string) ?? '';
        if (cfgDirection && cfgDirection !== (ctx.callDirection ?? '')) continue;
      }

      if (triggerType === 'sheets_row_added') {
        const cfgIds = (triggerNode.config?.config_ids as string[]) ?? [];
        if (cfgIds.length > 0 && (!ctx.configId || !cfgIds.includes(ctx.configId))) continue;
      }

      // Calendar form submitted — must select at least one booking link; blank = don't fire
      if (triggerType === 'calendar_form_submitted') {
        const cfgCalendars = (triggerNode.config?.calendars as string[]) ?? [];
        if (cfgCalendars.length === 0) continue;
        if (!cfgCalendars.includes(ctx.calendarId ?? '')) continue;
      }

      // ── Re-entry handling ─────────────────────────────────────────────────
      if (options?.forceReEntry || wf.allow_reentry) {
        // Supersede any existing completed/running execution so re-entry works cleanly.
        // forceReEntry=true: triggered by a re-submission with changed data (e.g. new pincode).
        // allow_reentry=true: workflow is configured for unlimited re-entry.
        // Without this, the DB unique guard (idx_wf_exec_one_enrollment) would silently block re-entry.
        await query(
          `UPDATE workflow_executions SET status='superseded'
           WHERE workflow_id=$1 AND lead_id=$2 AND status IN ('running', 'completed')`,
          [wf.id, enrichedLead.id]
        ).catch(() => null);
      } else {
        // allow_reentry=false and no force: skip if any execution exists for this lead
        const existing = await query(
          `SELECT id FROM workflow_executions WHERE workflow_id=$1 AND lead_id=$2 LIMIT 1`,
          [wf.id, enrichedLead.id]
        );
        if (existing.rows.length > 0) {
          console.log(`[WF] "${wf.name}" skipped — lead already enrolled & allow_reentry=false`);
          const skipExec = await query(
            `INSERT INTO workflow_executions
               (workflow_id, tenant_id, lead_id, lead_name, trigger_type, status, enrolled_at, completed_at)
             VALUES ($1,$2,$3,$4,$5,'skipped',NOW(),NOW()) RETURNING id`,
            [wf.id, tenantId, enrichedLead.id, enrichedLead.name, triggerType]
          ).catch(() => null);
          if (skipExec?.rows[0]) {
            await query(
              `INSERT INTO workflow_execution_logs
                 (execution_id, workflow_id, tenant_id, node_id, action_type, status, message)
               VALUES ($1,$2,$3,'reentry_blocked','reentry_blocked','skipped',
                       'Reentry blocked — contact already enrolled (allow_reentry=false)')`,
              [skipExec.rows[0].id, wf.id, tenantId]
            ).catch(() => null);
            await query(
              `UPDATE workflows SET skipped=skipped+1, updated_at=NOW() WHERE id=$1`,
              [wf.id]
            ).catch(() => null);
          }
          continue;
        }
      }

      // ── Goal: auto-exit if already met ───────────────────────────────────
      if (wf.goal_trigger && wf.goal_field && wf.goal_operator) {
        const goalMet = (() => {
          const raw = String((enrichedLead as any)[wf.goal_field] ?? '');
          const val = (wf.goal_value ?? '').toLowerCase();
          const lead_val = raw.toLowerCase();
          switch (wf.goal_operator) {
            case 'equals':     return lead_val === val;
            case 'not_equals': return lead_val !== val;
            case 'contains':   return lead_val.includes(val);
            case 'is_empty':   return lead_val === '';
            default:           return false;
          }
        })();
        if (goalMet) continue;
      }

      // ── Create execution record ───────────────────────────────────────────
      let execResult: any;
      try {
        execResult = await query(
          `INSERT INTO workflow_executions
             (workflow_id, tenant_id, lead_id, lead_name, trigger_type, status, enrolled_at)
           VALUES ($1,$2,$3,$4,$5,'running',NOW()) RETURNING id`,
          [wf.id, tenantId, enrichedLead.id, enrichedLead.name, triggerType]
        );
      } catch (insertErr: any) {
        if (insertErr.code === '23505') {
          // Unique constraint hit — concurrent duplicate trigger, treat as reentry blocked
          console.log(`[WF] "${wf.name}" blocked by DB guard — concurrent duplicate trigger for lead ${enrichedLead.id}`);
          await query(
            `INSERT INTO workflow_executions
               (workflow_id, tenant_id, lead_id, lead_name, trigger_type, status, enrolled_at, completed_at)
             VALUES ($1,$2,$3,$4,$5,'skipped',NOW(),NOW())`,
            [wf.id, tenantId, enrichedLead.id, enrichedLead.name, triggerType]
          ).catch(() => null);
          await query(`UPDATE workflows SET skipped=skipped+1, updated_at=NOW() WHERE id=$1`, [wf.id]).catch(() => null);
          continue;
        }
        throw insertErr;
      }
      const executionId = execResult.rows[0].id;

      try {
        const stats = await executeNodes(nodes, enrichedLead, tenantId, userId, executionId, wf.id);
        const execStatus = stats.failed > 0 ? 'completed_with_errors' : 'completed';
        await query(
          `UPDATE workflow_executions SET status=$1, completed_at=NOW() WHERE id=$2`,
          [execStatus, executionId]
        );
        await query(
          `UPDATE workflows SET total_contacts=total_contacts+1,
           completed=completed+$2, completed_with_errors=completed_with_errors+$3,
           skipped=skipped+$4, failed=failed+$5, updated_at=NOW() WHERE id=$1`,
          [wf.id, stats.failed === 0 ? 1 : 0, stats.failed > 0 ? 1 : 0, stats.skipped, stats.failed]
        );
      } catch (err: any) {
        await query(
          `UPDATE workflow_executions SET status='failed', completed_at=NOW(), error=$1 WHERE id=$2`,
          [err.message ?? 'Unknown error', executionId]
        );
        await query(
          `UPDATE workflows SET total_contacts=total_contacts+1, failed=failed+1, updated_at=NOW() WHERE id=$1`,
          [wf.id]
        );
      }
    }
  } catch (err) {
    console.error('[Workflow Engine] Error:', err);
  }
}

// ── Schedule trigger worker ────────────────────────────────────────────────────
// Called every 60 seconds from index.ts. Checks workflows whose trigger is a
// time-based schedule and fires them if the current time matches the config.
async function runScheduledBroadcast(wf: any, nodes: WFNode[]): Promise<void> {
  const broadcastIdx = nodes.findIndex((n: WFNode) => n.actionType === 'broadcast_group');
  if (broadcastIdx === -1) return;

  const broadcastNode = nodes[broadcastIdx];
  const afterNodes    = nodes.slice(broadcastIdx + 1);

  const groupId       = broadcastNode.config?.group_id as string;
  if (!groupId) { console.log('[Scheduler] broadcast_group: no group configured'); return; }

  const intervalValue = Number(broadcastNode.config?.interval_value ?? 2);
  const intervalUnit  = (broadcastNode.config?.interval_unit as string) ?? 'minutes';
  const intervalMs    =
    intervalUnit === 'hours'   ? intervalValue * 3600000 :
    intervalUnit === 'minutes' ? intervalValue * 60000   :
                                 intervalValue * 1000;

  const grpRes = await query(
    `SELECT id, name FROM contact_groups WHERE id=$1::uuid AND tenant_id=$2::uuid`,
    [groupId, wf.tenant_id]
  );
  if (!grpRes.rows[0]) { console.log('[Scheduler] broadcast_group: group not found'); return; }

  const membersRes = await query(
    `SELECT l.id, l.name FROM contact_group_members cgm
     JOIN leads l ON l.id = cgm.lead_id AND l.is_deleted = FALSE
     WHERE cgm.group_id = $1::uuid`,
    [groupId]
  );
  const members = membersRes.rows;
  console.log(`[Scheduler] broadcast_group "${wf.name}" → ${members.length} leads queued, interval=${intervalValue} ${intervalUnit}`);

  const now = Date.now();
  for (let i = 0; i < members.length; i++) {
    const sendAt = new Date(now + i * intervalMs);
    await query(
      `INSERT INTO broadcast_queue
         (workflow_id, tenant_id, lead_id, broadcast_node_id, nodes, trigger_type, allow_reentry, send_at)
       VALUES ($1,$2,$3,$4,$5,'broadcast_group',$6,$7)`,
      [wf.id, wf.tenant_id, members[i].id, broadcastNode.id ?? 'broadcast_group',
       JSON.stringify(afterNodes), wf.allow_reentry ?? false, sendAt]
    ).catch((e: any) => console.error('[Broadcast] queue insert failed:', e.message));
  }
}

// ── Broadcast queue worker ─────────────────────────────────────────────────────
// Runs every 30s. Picks up to 10 rows where send_at <= NOW() and processes them.
// Using FOR UPDATE SKIP LOCKED so cluster-mode PM2 processes don't double-send.
export async function processBroadcastQueue(): Promise<void> {
  try {
    const res = await query(
      `UPDATE broadcast_queue SET status='processing'
       WHERE id IN (
         SELECT id FROM broadcast_queue
         WHERE status='pending' AND send_at <= NOW()
         ORDER BY send_at
         LIMIT 10
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      []
    ).catch(() => ({ rows: [] as any[] }));

    for (const row of res.rows) {
      try {
        const nodes: WFNode[] = Array.isArray(row.nodes) ? row.nodes : JSON.parse(row.nodes ?? '[]');
        const triggerType     = (row.trigger_type as string) ?? 'broadcast_group';

        // Respect allow_reentry
        if (!row.allow_reentry) {
          const ex = await query(
            `SELECT id FROM workflow_executions WHERE workflow_id=$1 AND lead_id=$2 LIMIT 1`,
            [row.workflow_id, row.lead_id]
          );
          if (ex.rows.length > 0) {
            await query(`UPDATE broadcast_queue SET status='skipped', processed_at=NOW() WHERE id=$1`, [row.id]);
            continue;
          }
        }

        const leadRes = await query(
          `SELECT l.*, ps.name AS stage_name, p.name AS pipeline_name, u.name AS assigned_staff_name
           FROM leads l
           LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
           LEFT JOIN pipelines p ON p.id = l.pipeline_id
           LEFT JOIN users u ON u.id = l.assigned_to
           WHERE l.id=$1::uuid AND l.tenant_id=$2::uuid AND l.is_deleted=FALSE`,
          [row.lead_id, row.tenant_id]
        );
        if (!leadRes.rows[0]) {
          await query(`UPDATE broadcast_queue SET status='skipped', error='Lead not found or deleted', processed_at=NOW() WHERE id=$1`, [row.id]);
          continue;
        }
        const enrichedLead = await enrichLead(leadRes.rows[0] as LeadContext);

        const execRes = await query(
          `INSERT INTO workflow_executions
             (workflow_id, tenant_id, lead_id, lead_name, trigger_type, status, enrolled_at)
           VALUES ($1,$2,$3,$4,$5,'running',NOW()) RETURNING id`,
          [row.workflow_id, row.tenant_id, row.lead_id, enrichedLead.name, triggerType]
        );
        if (!execRes.rows[0]) {
          await query(`UPDATE broadcast_queue SET status='failed', error='Failed to create execution', processed_at=NOW() WHERE id=$1`, [row.id]);
          continue;
        }
        const executionId = execRes.rows[0].id;

        // For broadcast_group action path: log the orchestrator node as completed
        if (row.broadcast_node_id) {
          await query(
            `INSERT INTO workflow_execution_logs
               (execution_id, workflow_id, tenant_id, node_id, action_type, status, message)
             VALUES ($1,$2,$3,$4,'broadcast_group','completed','Broadcast dispatched — sending to group member')`,
            [executionId, row.workflow_id, row.tenant_id, row.broadcast_node_id]
          ).catch(() => null);
        }

        try {
          const stats = nodes.length > 0
            ? await executeNodes(nodes, enrichedLead, row.tenant_id, 'scheduler', executionId, row.workflow_id)
            : { skipped: 0, failed: 0 };
          const execStatus = stats.failed > 0 ? 'completed_with_errors' : 'completed';
          await query(`UPDATE workflow_executions SET status=$1, completed_at=NOW() WHERE id=$2`, [execStatus, executionId]);
          await query(
            `UPDATE workflows SET total_contacts=total_contacts+1, completed=completed+$2, completed_with_errors=completed_with_errors+$3, skipped=skipped+$4, failed=failed+$5, updated_at=NOW() WHERE id=$1`,
            [row.workflow_id, stats.failed === 0 ? 1 : 0, stats.failed > 0 ? 1 : 0, stats.skipped, stats.failed]
          ).catch(() => null);
          await query(`UPDATE broadcast_queue SET status='completed', processed_at=NOW() WHERE id=$1`, [row.id]);
        } catch (err: any) {
          await query(`UPDATE workflow_executions SET status='failed', completed_at=NOW(), error=$1 WHERE id=$2`, [err.message ?? 'Unknown', executionId]).catch(() => null);
          await query(`UPDATE workflows SET total_contacts=total_contacts+1, failed=failed+1, updated_at=NOW() WHERE id=$1`, [row.workflow_id]).catch(() => null);
          await query(`UPDATE broadcast_queue SET status='failed', error=$1, processed_at=NOW() WHERE id=$2`, [err.message ?? 'Unknown', row.id]).catch(() => null);
        }

        // Deactivate specific_date broadcast workflows only when the full queue is done
        const remaining = await query(
          `SELECT count(*) FROM broadcast_queue WHERE workflow_id=$1::uuid AND status IN ('pending','processing')`,
          [row.workflow_id]
        ).catch(() => ({ rows: [{ count: '1' }] }));
        if (parseInt(remaining.rows[0]?.count ?? '1') === 0) {
          await query(
            `UPDATE workflows SET status='inactive', updated_at=NOW()
             WHERE id=$1::uuid AND trigger_key='specific_date' AND status='active'`,
            [row.workflow_id]
          ).catch(() => null);
          console.log(`[BroadcastQueue] workflow ${row.workflow_id} queue empty — deactivated`);
        }
      } catch (e: any) {
        console.error('[BroadcastQueue] error processing row', row.id, e.message);
        await query(`UPDATE broadcast_queue SET status='failed', error=$1, processed_at=NOW() WHERE id=$2`, [e.message, row.id]).catch(() => null);
      }
    }
  } catch (err) {
    console.error('[BroadcastQueue] worker error:', err);
  }
}

// Convert a Date to { date: "YYYY-MM-DD", time: "HH:MM", day: "Monday", dom: N } in a given timezone
function getTimeParts(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'long',
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
    day: parts.weekday,
    dom: parseInt(parts.day, 10),
  };
}

// Returns true if the scheduled HH:MM falls within the past 2 minutes of now (handles worker timing drift)
function withinFireWindow(now: Date, scheduledHhmm: string, scheduledDate: string, tz: string): boolean {
  for (let offset = 0; offset <= 120; offset += 60) {
    const t = new Date(now.getTime() - offset * 1000);
    const p = getTimeParts(t, tz);
    if (p.date === scheduledDate && p.time === scheduledHhmm) return true;
  }
  return false;
}

export async function processScheduledTriggers(): Promise<void> {
  try {
    const now = new Date();

    const wfs = await query(
      `SELECT * FROM workflows WHERE status='active'
       AND trigger_key IN ('specific_date','weekly_recurring','monthly_recurring')`,
      []
    ).catch(() => ({ rows: [] as any[] }));

    for (const wf of wfs.rows) {
      const nodes: WFNode[] = Array.isArray(wf.nodes) ? wf.nodes : (typeof wf.nodes === 'string' ? JSON.parse(wf.nodes) : []);
      const tn = nodes.find((n: WFNode) => n.type === 'trigger');
      if (!tn) continue;
      const cfg = tn.config ?? {};

      // Use configured timezone (default IST); compare current time in that zone
      const tz = (cfg.timezone as string) || 'Asia/Kolkata';
      const p = getTimeParts(now, tz);

      // Check whether this workflow fires right now
      let shouldFire = false;
      if (wf.trigger_key === 'specific_date') {
        // 2-minute window handles cases where the 60s worker fires slightly after the scheduled minute
        shouldFire = withinFireWindow(now, cfg.time as string, cfg.date as string, tz);
      } else if (wf.trigger_key === 'weekly_recurring') {
        const days: string[] = Array.isArray(cfg.days) ? cfg.days as string[] : [];
        shouldFire = days.includes(p.day) && (cfg.time as string) === p.time;
      } else if (wf.trigger_key === 'monthly_recurring') {
        const dom = parseInt(String(cfg.dayOfMonth ?? '0'));
        shouldFire = dom === p.dom && (cfg.time as string) === p.time;
      }
      if (!shouldFire) continue;

      console.log(`[Scheduler] "${wf.name}" firing at ${p.time} ${tz} (UTC: ${now.toISOString()})`);

      // If workflow has a broadcast_group action, fan out to group members instead of all leads
      const hasBroadcastAction = nodes.some((n: WFNode) => n.actionType === 'broadcast_group');
      if (hasBroadcastAction) {
        // Skip re-firing if a broadcast is already in progress for this workflow
        const inProgress = await query(
          `SELECT count(*) FROM broadcast_queue WHERE workflow_id=$1::uuid AND status IN ('pending','processing')`,
          [wf.id]
        ).catch(() => ({ rows: [{ count: '1' }] }));
        if (parseInt(inProgress.rows[0]?.count ?? '1') > 0) {
          console.log(`[Scheduler] "${wf.name}" broadcast already in progress — skipping re-fire`);
          continue;
        }
        console.log(`[Scheduler] "${wf.name}" has broadcast_group action — running scheduled broadcast`);
        await runScheduledBroadcast(wf, nodes).catch((e) => console.error('[Scheduler] broadcast error:', e.message));
      } else {
        // Fire for all active leads of this tenant (up to 500 at a time)
        const leadsRes = await query(
          `SELECT id, name, email, phone, pipeline_id, stage_id, assigned_to, tags, source
           FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE LIMIT 500`,
          [wf.tenant_id]
        ).catch(() => ({ rows: [] as any[] }));

        console.log(`[Scheduler] "${wf.name}" firing for ${leadsRes.rows.length} leads`);
        for (const lead of leadsRes.rows) {
          await triggerWorkflows(wf.trigger_key, lead, wf.tenant_id, 'scheduler', { forceReEntry: true }).catch(() => null);
        }
      }

      // Auto-deactivate one-shot date workflows after they fire,
      // but NOT broadcast workflows — those deactivate when the queue empties
      if (wf.trigger_key === 'specific_date' && !hasBroadcastAction) {
        await query(
          `UPDATE workflows SET status='inactive', updated_at=NOW() WHERE id=$1`,
          [wf.id]
        ).catch(() => null);
        console.log(`[Scheduler] "${wf.name}" (specific_date) deactivated after firing`);
      }
    }
  } catch (err) {
    console.error('[Scheduler] processScheduledTriggers error:', err);
  }
}

// ── Analytics endpoint (Task #11) ─────────────────────────────────────────────

router.get('/:id/analytics', async (req: AuthRequest, res: Response) => {
  try {
    const wfRes = await query(
      `SELECT id, name, status, created_at FROM workflows WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, req.user!.tenantId]
    );
    if (!wfRes.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }

    // Compute KPIs live from workflow_executions (not stale denormalized columns)
    const kpiRes = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status != 'superseded')                              AS total_contacts,
         COUNT(*) FILTER (WHERE status = 'completed')                                AS completed,
         COUNT(*) FILTER (WHERE status = 'failed')                                   AS failed,
         COUNT(DISTINCT COALESCE(lead_id::text, id::text)) FILTER (WHERE status = 'skipped') AS skipped
       FROM workflow_executions
       WHERE workflow_id=$1`,
      [req.params.id]
    ).catch(() => ({ rows: [{ total_contacts: 0, completed: 0, failed: 0, skipped: 0 }] }));

    const wf = {
      ...wfRes.rows[0],
      total_contacts: Number(kpiRes.rows[0]?.total_contacts ?? 0),
      completed:      Number(kpiRes.rows[0]?.completed      ?? 0),
      failed:         Number(kpiRes.rows[0]?.failed         ?? 0),
      skipped:        Number(kpiRes.rows[0]?.skipped        ?? 0),
    };

    // Execution breakdown by day (last 30 days) — exclude superseded
    const dailyRes = await query(
      `SELECT DATE_TRUNC('day', enrolled_at) AS day,
              COUNT(*) FILTER (WHERE status='completed') AS completed,
              COUNT(*) FILTER (WHERE status='failed')    AS failed,
              COUNT(*) FILTER (WHERE status != 'superseded') AS total
       FROM workflow_executions
       WHERE workflow_id=$1 AND enrolled_at > NOW() - INTERVAL '30 days'
       GROUP BY 1 ORDER BY 1`,
      [req.params.id]
    ).catch(() => ({ rows: [] }));

    // Step breakdown — exclude logs from superseded executions
    const stepRes = await query(
      `SELECT l.action_type,
              COUNT(*) FILTER (WHERE l.status='completed') AS completed,
              COUNT(*) FILTER (WHERE l.status='skipped')   AS skipped,
              COUNT(*) FILTER (WHERE l.status='failed')    AS failed,
              COUNT(*) AS total
       FROM workflow_execution_logs l
       JOIN workflow_executions e ON e.id = l.execution_id
       WHERE e.workflow_id=$1 AND e.status NOT IN ('superseded')
       GROUP BY l.action_type ORDER BY total DESC LIMIT 20`,
      [req.params.id]
    ).catch(() => ({ rows: [] }));

    // Recent executions
    const recentRes = await query(
      `SELECT id, lead_name, trigger_type, status, enrolled_at, completed_at
       FROM workflow_executions
       WHERE workflow_id=$1
       ORDER BY enrolled_at DESC LIMIT 50`,
      [req.params.id]
    ).catch(() => ({ rows: [] }));

    res.json({
      workflow: wf,
      daily:    dailyRes.rows,
      steps:    stepRes.rows,
      recent:   recentRes.rows,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Workflow versions (Task #12) ──────────────────────────────────────────────

router.get('/:id/versions', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT id, version, name, saved_by, created_at FROM workflow_versions
       WHERE workflow_id=$1 AND tenant_id=$2 ORDER BY version DESC LIMIT 30`,
      [req.params.id, req.user!.tenantId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id/versions/:vId', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM workflow_versions WHERE id=$1 AND workflow_id=$2 AND tenant_id=$3`,
      [req.params.vId, req.params.id, req.user!.tenantId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Snapshot a version when workflow is saved (called by PATCH /:id via middleware)
async function snapshotVersion(workflowId: string, tenantId: string, name: string, nodes: any[], userId: string) {
  const lastVer = await query(
    `SELECT COALESCE(MAX(version), 0) AS v FROM workflow_versions WHERE workflow_id=$1`,
    [workflowId]
  );
  const nextVer = (lastVer.rows[0]?.v ?? 0) + 1;
  await query(
    `INSERT INTO workflow_versions (workflow_id, tenant_id, version, name, nodes, saved_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [workflowId, tenantId, nextVer, name, JSON.stringify(nodes), userId]
  );
}

// Override PATCH to also snapshot
router.patch('/:id/snapshot', checkPermission('automation:manage'), async (req: AuthRequest, res: Response) => {
  const { name, nodes } = req.body;
  if (!nodes) { res.status(400).json({ error: 'nodes required' }); return; }
  try {
    await snapshotVersion(req.params.id, req.user!.tenantId!, name ?? 'Untitled', nodes, req.user!.userId!);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Test a specific workflow against a contact ────────────────────────────────
// POST /api/workflows/:id/test
router.post('/:id/test', checkPermission('automation:manage'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const { lead_id, phone, name } = req.body as { lead_id?: string; phone?: string; name?: string };

  try {
    // Fetch the workflow (doesn't need to be active for testing)
    const wfRes = await query(
      `SELECT * FROM workflows WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tenantId]
    );
    if (!wfRes.rows[0]) { res.status(404).json({ error: 'Workflow not found' }); return; }
    const wf = wfRes.rows[0];
    const nodes: WFNode[] = Array.isArray(wf.nodes) ? wf.nodes : (typeof wf.nodes === 'string' ? JSON.parse(wf.nodes) : []);

    let lead: LeadContext;

    if (lead_id) {
      const leadRes = await query(
        `SELECT l.id, l.name, l.email, l.phone, l.stage_id, l.pipeline_id, l.assigned_to, l.tags, l.source, l.status,
                ps.name AS stage_name, p.name AS pipeline_name, u.name AS assigned_staff_name
         FROM leads l
         LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
         LEFT JOIN pipelines p ON p.id = l.pipeline_id
         LEFT JOIN users u ON u.id = l.assigned_to
         WHERE l.id=$1 AND l.tenant_id=$2 AND l.is_deleted=FALSE`,
        [lead_id, tenantId]
      );
      if (!leadRes.rows[0]) { res.status(404).json({ error: 'Lead not found' }); return; }
      lead = leadRes.rows[0] as LeadContext;
    } else if (phone) {
      // Build a minimal test lead from phone number
      const existing = await query(
        `SELECT l.id, l.name, l.email, l.phone, l.stage_id, l.pipeline_id, l.assigned_to, l.tags, l.source, l.status,
                ps.name AS stage_name, p.name AS pipeline_name, u.name AS assigned_staff_name
         FROM leads l
         LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
         LEFT JOIN pipelines p ON p.id = l.pipeline_id
         LEFT JOIN users u ON u.id = l.assigned_to
         WHERE l.phone=$1 AND l.tenant_id=$2 AND l.is_deleted=FALSE LIMIT 1`,
        [phone, tenantId]
      );
      if (existing.rows[0]) {
        lead = existing.rows[0] as LeadContext;
      } else {
        lead = { id: `test-${Date.now()}`, name: name || phone, phone };
      }
    } else if (name) {
      // Re-execute for a test run that had no real lead — rebuild a minimal context
      lead = { id: `test-${Date.now()}`, name };
    } else {
      res.status(400).json({ error: 'Provide lead_id, phone, or name' }); return;
    }

    const enrichedLead = await enrichLead(lead);

    // For contact_tagged trigger: check current lead tags against configured tags
    const triggerNode = nodes.find((n: WFNode) => n.type === 'trigger');
    if (triggerNode?.actionType === 'contact_tagged') {
      const cfgTags: string[] = Array.isArray(triggerNode.config?.tags)
        ? (triggerNode.config!.tags as string[])
        : (triggerNode.config?.tag as string) ? [(triggerNode.config!.tag as string)] : [];
      if (cfgTags.length > 0) {
        const leadTags: string[] = Array.isArray(enrichedLead.tags) ? (enrichedLead.tags as string[]) : [];
        const hasTag = leadTags.some((t) => cfgTags.includes(t));
        if (!hasTag) {
          res.json({ skipped: true, reason: `Lead does not have any of the required tags: ${cfgTags.join(', ')}` });
          return;
        }
      }
    }

    // Supersede any existing running/completed execution so repeated test runs work
    const testLeadId = enrichedLead.id?.startsWith('test-') ? null : enrichedLead.id;
    if (testLeadId) {
      await query(
        `UPDATE workflow_executions SET status='superseded'
         WHERE workflow_id=$1 AND lead_id=$2 AND status IN ('running','completed')`,
        [wf.id, testLeadId]
      );
    }

    // Create a test execution record
    const execResult = await query(
      `INSERT INTO workflow_executions
         (workflow_id, tenant_id, lead_id, lead_name, trigger_type, status, enrolled_at)
       VALUES ($1,$2,$3,$4,'test','running',NOW()) RETURNING id`,
      [wf.id, tenantId, testLeadId, enrichedLead.name]
    );
    const executionId = execResult.rows[0].id;

    try {
      const stats = await executeNodes(nodes, enrichedLead, tenantId!, userId!, executionId, wf.id);
      const tExecStatus = stats.failed > 0 ? 'completed_with_errors' : 'completed';
      await query(
        `UPDATE workflow_executions SET status=$1, completed_at=NOW() WHERE id=$2`,
        [tExecStatus, executionId]
      );
      // Increment workflow-level counters so row badges reflect test runs
      await query(
        `UPDATE workflows SET total_contacts=total_contacts+1,
         completed=completed+$2, completed_with_errors=completed_with_errors+$3,
         skipped=skipped+$4, failed=failed+$5, updated_at=NOW() WHERE id=$1`,
        [wf.id, stats.failed === 0 ? 1 : 0, stats.failed > 0 ? 1 : 0, stats.skipped, stats.failed]
      ).catch(() => null);
      // Fetch per-node results from execution logs
      const logsRes = await query(
        `SELECT node_id, status, message FROM workflow_execution_logs WHERE execution_id=$1`,
        [executionId]
      );
      const nodeResults: Record<string, { status: string; message: string }> = {};
      for (const row of logsRes.rows) {
        nodeResults[row.node_id] = { status: row.status, message: row.message ?? '' };
      }
      res.json({
        success: true,
        message: stats.failed > 0 ? `${stats.failed} action(s) failed` : 'All actions completed',
        executionId, stats, nodeResults,
      });
    } catch (err: any) {
      await query(
        `UPDATE workflow_executions SET status='failed', completed_at=NOW(), error=$1 WHERE id=$2`,
        [err.message ?? 'Unknown error', executionId]
      );
      // Increment failed counter so badge updates
      await query(
        `UPDATE workflows SET total_contacts=total_contacts+1, failed=failed+1, updated_at=NOW() WHERE id=$1`,
        [wf.id]
      ).catch(() => null);
      // Still try to return partial node results
      const logsRes = await query(
        `SELECT node_id, status, message FROM workflow_execution_logs WHERE execution_id=$1`,
        [executionId]
      ).catch(() => ({ rows: [] }));
      const nodeResults: Record<string, { status: string; message: string }> = {};
      for (const row of logsRes.rows) {
        nodeResults[row.node_id] = { status: row.status, message: row.message ?? '' };
      }
      res.status(500).json({ error: err.message ?? 'Workflow execution failed', executionId, nodeResults });
    }
  } catch (err) {
    console.error('[Test Workflow]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Manually push a list of contacts into a workflow ──────────────────────────
// POST /api/workflows/:id/bulk-trigger  { lead_ids: string[] }
router.post('/:id/bulk-trigger', checkPermission('automation:manage'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const { lead_ids, force } = req.body as { lead_ids?: string[]; force?: boolean };

  if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
    res.status(400).json({ error: 'lead_ids array required' }); return;
  }

  try {
    const wfRes = await query(
      `SELECT * FROM workflows WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tenantId]
    );
    if (!wfRes.rows[0]) { res.status(404).json({ error: 'Workflow not found' }); return; }
    const wf = wfRes.rows[0];
    const nodes: WFNode[] = Array.isArray(wf.nodes) ? wf.nodes : JSON.parse(wf.nodes ?? '[]');

    // Respond immediately — execution runs in background
    res.json({ queued: lead_ids.length, workflow: wf.name });

    for (const leadId of lead_ids) {
      setImmediate(async () => {
        try {
          // Check allow_reentry (bypassed when force=true, e.g. manual retry of skipped)
          if (!force && !wf.allow_reentry) {
            const ex = await query(
              `SELECT id FROM workflow_executions WHERE workflow_id=$1 AND lead_id=$2 LIMIT 1`,
              [wf.id, leadId]
            );
            if (ex.rows.length > 0) return;
          }

          const leadRes = await query(
            `SELECT l.*, ps.name AS stage_name, p.name AS pipeline_name, u.name AS assigned_staff_name
             FROM leads l
             LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
             LEFT JOIN pipelines p ON p.id = l.pipeline_id
             LEFT JOIN users u ON u.id = l.assigned_to
             WHERE l.id=$1::uuid AND l.tenant_id=$2::uuid AND l.is_deleted=FALSE`,
            [leadId, tenantId]
          );
          if (!leadRes.rows[0]) return;
          const enrichedLead = await enrichLead(leadRes.rows[0] as LeadContext);

          // For contact_tagged trigger: skip leads that don't currently have a configured tag
          const bulkTriggerNode = nodes.find((n: WFNode) => n.type === 'trigger');
          if (bulkTriggerNode?.actionType === 'contact_tagged') {
            const cfgTags: string[] = Array.isArray(bulkTriggerNode.config?.tags)
              ? (bulkTriggerNode.config!.tags as string[])
              : (bulkTriggerNode.config?.tag as string) ? [(bulkTriggerNode.config!.tag as string)] : [];
            if (cfgTags.length > 0) {
              const leadTags: string[] = Array.isArray(enrichedLead.tags) ? (enrichedLead.tags as string[]) : [];
              if (!leadTags.some((t) => cfgTags.includes(t))) return;
            }
          }

          const execRes = await query(
            `INSERT INTO workflow_executions
               (workflow_id, tenant_id, lead_id, lead_name, trigger_type, status, enrolled_at)
             VALUES ($1,$2,$3,$4,'manual','running',NOW()) RETURNING id`,
            [wf.id, tenantId, leadId, enrichedLead.name]
          );
          const executionId = execRes.rows[0].id;

          try {
            const stats = await executeNodes(nodes, enrichedLead, tenantId!, userId!, executionId, wf.id);
            const bExecStatus = stats.failed > 0 ? 'completed_with_errors' : 'completed';
            await query(`UPDATE workflow_executions SET status=$1, completed_at=NOW() WHERE id=$2`, [bExecStatus, executionId]);
            await query(
              `UPDATE workflows SET total_contacts=total_contacts+1, completed=completed+$2, completed_with_errors=completed_with_errors+$3, skipped=skipped+$4, failed=failed+$5, updated_at=NOW() WHERE id=$1`,
              [wf.id, stats.failed === 0 ? 1 : 0, stats.failed > 0 ? 1 : 0, stats.skipped, stats.failed]
            ).catch(() => null);
          } catch (err: any) {
            await query(
              `UPDATE workflow_executions SET status='failed', completed_at=NOW(), error=$1 WHERE id=$2`,
              [err.message ?? 'Unknown', executionId]
            ).catch(() => null);
            await query(
              `UPDATE workflows SET total_contacts=total_contacts+1, failed=failed+1, updated_at=NOW() WHERE id=$1`,
              [wf.id]
            ).catch(() => null);
          }
        } catch (e: any) {
          console.error('[bulk-trigger] lead', leadId, e.message);
        }
      });
    }
  } catch (err) {
    console.error('[bulk-trigger]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

// ── Broadcast to Group — staggered interval send ──────────────────────────────
// POST /api/workflows/:id/broadcast-group
router.post('/:id/broadcast-group', checkPermission('automation:manage'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  try {
    const wfRes = await query(
      `SELECT * FROM workflows WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tenantId]
    );
    if (!wfRes.rows[0]) { res.status(404).json({ error: 'Workflow not found' }); return; }
    const wf = wfRes.rows[0];
    const nodes: WFNode[] = Array.isArray(wf.nodes) ? wf.nodes : JSON.parse(wf.nodes ?? '[]');

    const triggerNode = nodes.find((n: WFNode) => n.type === 'trigger');
    if (triggerNode?.actionType !== 'broadcast_to_group') {
      res.status(400).json({ error: 'This workflow does not use a Broadcast to Group trigger' }); return;
    }

    const groupId       = triggerNode.config?.group_id as string;
    const intervalValue = Number(triggerNode.config?.interval_value ?? 2);
    const intervalUnit  = (triggerNode.config?.interval_unit as string) ?? 'minutes';

    if (!groupId) {
      res.status(400).json({ error: 'No contact group configured on this workflow trigger' }); return;
    }

    const intervalMs =
      intervalUnit === 'hours'   ? intervalValue * 3600 * 1000 :
      intervalUnit === 'minutes' ? intervalValue * 60   * 1000 :
                                   intervalValue         * 1000; // seconds

    const grpRes = await query(
      `SELECT id, name FROM contact_groups WHERE id=$1::uuid AND tenant_id=$2::uuid`,
      [groupId, tenantId]
    );
    if (!grpRes.rows[0]) { res.status(404).json({ error: 'Contact group not found' }); return; }

    const membersRes = await query(
      `SELECT l.id, l.name FROM contact_group_members cgm
       JOIN leads l ON l.id = cgm.lead_id AND l.is_deleted = FALSE
       WHERE cgm.group_id = $1::uuid`,
      [groupId]
    );
    const members = membersRes.rows;
    if (members.length === 0) { res.status(400).json({ error: 'Contact group has no members' }); return; }

    const estimatedMinutes = Math.ceil((members.length - 1) * intervalMs / 60000);
    res.json({ queued: members.length, group: grpRes.rows[0].name, interval_ms: intervalMs, estimated_minutes: estimatedMinutes });

    const now = Date.now();
    for (let i = 0; i < members.length; i++) {
      const sendAt = new Date(now + i * intervalMs);
      await query(
        `INSERT INTO broadcast_queue
           (workflow_id, tenant_id, lead_id, nodes, trigger_type, allow_reentry, send_at)
         VALUES ($1,$2,$3,$4,'broadcast_to_group',$5,$6)`,
        [wf.id, tenantId, members[i].id, JSON.stringify(nodes), wf.allow_reentry ?? false, sendAt]
      ).catch((e: any) => console.error('[broadcast-group] queue insert failed:', e.message));
    }
  } catch (err) {
    console.error('[broadcast-group]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

// ── Inbound webhook trigger (Task #5) ─────────────────────────────────────────
// POST /api/workflows/trigger/:tenantId (public, no auth)

export const publicWorkflowRouter: RouterType = Router();

publicWorkflowRouter.post('/trigger/:tenantId', async (req: any, res: any) => {
  const { tenantId } = req.params;
  const { lead_id, event, data } = req.body;
  if (!lead_id || !event) { res.status(400).json({ error: 'lead_id and event required' }); return; }

  try {
    const leadRes = await query(
      `SELECT id, name, email, phone, stage_id, pipeline_id, assigned_to, tags, source, status
       FROM leads WHERE id=$1 AND tenant_id=$2`,
      [lead_id, tenantId]
    );
    if (!leadRes.rows[0]) { res.status(404).json({ error: 'Lead not found' }); return; }
    const lead = { ...leadRes.rows[0], ...data };

    setImmediate(() => triggerWorkflows(event, lead, tenantId, 'api').catch(() => null));
    res.json({ success: true, message: `Trigger "${event}" queued for lead ${lead_id}` });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── API 1.0 execute endpoint ───────────────────────────────────────────────────
// POST /api/wf/:workflowId/execute  (public, authenticated by api_token in body)

publicWorkflowRouter.post('/:workflowId/execute', async (req: any, res: any) => {
  const { workflowId } = req.params;
  const body = req.body ?? {};

  const apiToken = body.api_token;
  if (!apiToken) {
    res.status(401).json({ status: 'error', message: 'api_token is required' });
    return;
  }

  try {
    // Validate api_token and load workflow
    const wfRes = await query(
      `SELECT id, tenant_id, status, nodes, allow_reentry
       FROM workflows
       WHERE id=$1::uuid AND api_token=$2::uuid`,
      [workflowId, apiToken]
    );
    if (!wfRes.rows[0]) {
      res.status(401).json({ status: 'error', message: 'Invalid api_token or workflow not found' });
      return;
    }
    const wf = wfRes.rows[0];
    if (wf.status !== 'active') {
      res.status(400).json({ status: 'error', message: 'Workflow is not active' });
      return;
    }

    // Extract contact fields (support both camelCase and snake_case keys)
    const contactEmail  = (body.contact_email  ?? body.email  ?? '').toString().trim().toLowerCase();
    const contactPhone  = (body.contact_phone  ?? body.phone  ?? '').toString().trim();
    const contactName   = (body.contact_name   ?? body.name   ?? '').toString().trim();

    if (!contactEmail && !contactPhone) {
      res.status(400).json({ status: 'error', message: 'contact_email or contact_phone is required' });
      return;
    }

    // Build extra custom fields from remaining body keys — clean {%...%} wrappers from keys
    const reservedKeys = new Set(['api_token','contact_email','contact_phone','contact_name','email','phone','name']);
    const extraFields: Record<string,string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!reservedKeys.has(k)) {
        const cleanKey = cleanFieldKey(k);
        if (cleanKey) extraFields[cleanKey] = String(v ?? '');
      }
    }

    const tenantId = wf.tenant_id;

    // Respond immediately — never let lead creation or DB errors cause a 500 to n8n
    res.json({
      status: 'success',
      message: 'Automation triggered successfully',
      data: { automation_id: workflowId }
    });

    // All DB work + workflow execution happens asynchronously after response is sent
    setImmediate(async () => {
      try {
        // Find or create lead
        let lead: any;

        const findClause = contactEmail
          ? `WHERE tenant_id=$1 AND LOWER(email)=$2 AND is_deleted=FALSE LIMIT 1`
          : `WHERE tenant_id=$1 AND phone=$2 AND is_deleted=FALSE LIMIT 1`;
        const findVal = contactEmail || contactPhone;

        const existing = await query(
          `SELECT id, name, email, phone, stage_id, pipeline_id, assigned_to, tags, source, status, custom_fields
           FROM leads ${findClause}`,
          [tenantId, findVal]
        );

        if (existing.rows[0]) {
          lead = existing.rows[0];
          if (Object.keys(extraFields).length > 0) {
            const merged = { ...(lead.custom_fields ?? {}), ...extraFields };
            await query(`UPDATE leads SET custom_fields=$1, updated_at=NOW() WHERE id=$2`, [JSON.stringify(merged), lead.id]);
            lead.custom_fields = merged;
            await backfillCustomFields(lead.id, tenantId, extraFields);
          }
        } else {
          const cfJson = Object.keys(extraFields).length > 0 ? JSON.stringify(extraFields) : '{}';
          let ins;
          let didInsert = false;
          try {
            ins = await query(
              `INSERT INTO leads (tenant_id, name, email, phone, source, custom_fields, created_at, updated_at)
               VALUES ($1, $2, $3, $4, 'api', $5::jsonb, NOW(), NOW())
               RETURNING id, name, email, phone, stage_id, pipeline_id, assigned_to, tags, source, status, custom_fields`,
              [tenantId, contactName || contactEmail || contactPhone, contactEmail || null, contactPhone || null, cfJson]
            );
            didInsert = true;
          } catch {
            // Race condition or constraint — retry SELECT
            const retry = await query(
              `SELECT id, name, email, phone, stage_id, pipeline_id, assigned_to, tags, source, status, custom_fields
               FROM leads ${findClause}`,
              [tenantId, findVal]
            );
            if (!retry.rows[0]) { console.error('[API1.0 execute] lead insert failed and retry found nothing'); return; }
            ins = { rows: [retry.rows[0]] };
          }
          lead = ins.rows[0];
          if (didInsert && lead) emitLeadCreated(tenantId, lead.id).catch(() => null);
          if (Object.keys(extraFields).length > 0) {
            await backfillCustomFields(lead.id, tenantId, extraFields);
          }
        }

        // Enforce allow_reentry
        if (!wf.allow_reentry) {
          const dup = await query(
            `SELECT id FROM workflow_executions
             WHERE workflow_id=$1 AND lead_id=$2 AND status IN ('running','completed') LIMIT 1`,
            [workflowId, lead.id]
          );
          if (dup.rows[0]) {
            await query(
              `INSERT INTO workflow_executions (workflow_id, lead_id, tenant_id, lead_name, trigger_type, status, enrolled_at, completed_at)
               VALUES ($1,$2,$3,$4,'api','skipped',NOW(),NOW())`,
              [workflowId, lead.id, tenantId, lead.name ?? '']
            ).catch(() => null);
            return;
          }
        } else {
          await query(
            `UPDATE workflow_executions SET status='superseded'
             WHERE workflow_id=$1 AND lead_id=$2 AND status IN ('running','completed')`,
            [workflowId, lead.id]
          );
        }
        const execIns = await query(
          `INSERT INTO workflow_executions (workflow_id, lead_id, tenant_id, lead_name, trigger_type, status, enrolled_at)
           VALUES ($1, $2, $3, $4, 'api', 'running', NOW()) RETURNING id`,
          [workflowId, lead.id, tenantId, lead.name ?? '']
        );
        const executionId = execIns.rows[0].id;
        const nodes: WFNode[] = wf.nodes ?? [];
        const enrichedLead = await enrichLead(lead);
        const stats = await executeNodes(nodes, enrichedLead, tenantId, 'api1', executionId, workflowId);
        await query(
          `UPDATE workflow_executions SET status='completed', completed_at=NOW() WHERE id=$1`,
          [executionId]
        );
        await query(
          `UPDATE workflows SET total_contacts=total_contacts+1, completed=completed+1,
           skipped=skipped+$2, failed=failed+$3, updated_at=NOW() WHERE id=$1`,
          [workflowId, stats.skipped, stats.failed]
        ).catch(() => null);
      } catch (err) {
        console.error('[API1.0 execute] async error:', err);
      }
    });
  } catch (err) {
    console.error('[API1.0 execute] error:', err);
    if (!res.headersSent) res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// ── Regenerate api_token ───────────────────────────────────────────────────────
// POST /api/workflows/:id/regenerate-token  (authenticated)
router.post('/:id/regenerate-token', checkPermission('automation:manage'), async (req: any, res: any) => {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;
  try {
    const result = await query(
      `UPDATE workflows SET api_token=gen_random_uuid(), updated_at=NOW()
       WHERE id=$1::uuid AND tenant_id=$2::uuid
       RETURNING api_token`,
      [id, tenantId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Workflow not found' }); return; }
    res.json({ api_token: result.rows[0].api_token });
  } catch (err) {
    console.error('[regenerate-token] error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Delay queue worker (Task #10) ─────────────────────────────────────────────

export async function processDelayedSteps(): Promise<void> {
  try {
    const due = await query(
      `SELECT * FROM scheduled_workflow_steps
       WHERE status='pending' AND run_at <= NOW()
       ORDER BY run_at ASC LIMIT 20`
    );
    for (const step of due.rows) {
      await query(
        `UPDATE scheduled_workflow_steps SET status='processing', updated_at=NOW() WHERE id=$1`,
        [step.id]
      );
      try {
        const snapshot: LeadContext = step.lead_data;
        const nodes: WFNode[]       = step.remaining_nodes;

        // Leak 10 fix: re-fetch lead so delayed steps use current state, not stale snapshot
        const freshRes = await query(
          `SELECT id, name, email, phone, stage_id, pipeline_id, assigned_to, tags, source, status
           FROM leads WHERE id=$1 AND is_deleted=FALSE LIMIT 1`,
          [snapshot.id]
        ).catch(() => ({ rows: [] }));
        const lead: LeadContext = freshRes.rows[0]
          ? { ...snapshot, ...freshRes.rows[0] }  // fresh DB values override stale snapshot
          : snapshot;                              // fallback: lead deleted, use snapshot for logging

        const enrichedLead = await enrichLead(lead);
        const delayStats = await executeNodes(nodes, enrichedLead, step.tenant_id, 'delay_worker', step.execution_id, step.workflow_id);
        await query(
          `UPDATE scheduled_workflow_steps SET status='completed', updated_at=NOW() WHERE id=$1`,
          [step.id]
        );
        await query(
          `UPDATE workflow_executions SET status='completed', completed_at=NOW() WHERE id=$1`,
          [step.execution_id]
        );
        await query(
          `UPDATE workflows SET skipped=skipped+$2, failed=failed+$3, updated_at=NOW() WHERE id=$1`,
          [step.workflow_id, delayStats.skipped, delayStats.failed]
        ).catch(() => null);
      } catch (err: any) {
        await query(
          `UPDATE scheduled_workflow_steps SET status='failed', error=$1, updated_at=NOW() WHERE id=$2`,
          [err.message ?? 'Unknown', step.id]
        );
      }
    }
  } catch (err) {
    console.error('[Delay Worker] Error:', err);
  }
}

export default router;
