import { Router, Response } from 'express';
import https from 'https';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';
import { sendEmail, getTenantEmailIdentity } from '../services/email';
import { decrypt } from '../utils/crypto';
import { triggerWorkflows } from './workflows';

function sendWARequest(phoneNumberId: string, token: string, payload: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v21.0/${phoneNumberId}/messages`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from WhatsApp API')); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendWAText(phoneNumberId: string, token: string, toPhone: string, text: string): Promise<any> {
  return sendWARequest(phoneNumberId, token, {
    messaging_product: 'whatsapp',
    to: toPhone.replace(/\D/g, ''),
    type: 'text',
    text: { body: text },
  });
}

function sendWATemplate(
  phoneNumberId: string, token: string, toPhone: string,
  templateName: string, languageCode: string,
  components: Array<{ type: string; parameters: Array<{ type: string; text?: string }> }>
): Promise<any> {
  const tplPayload: any = {
    messaging_product: 'whatsapp',
    to: toPhone.replace(/\D/g, ''),
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
    },
  };
  const withParams = components.filter((c) => c.parameters && c.parameters.length > 0);
  if (withParams.length > 0) {
    tplPayload.template.components = withParams;
  }
  return sendWARequest(phoneNumberId, token, tplPayload);
}

function interpolateBroadcast(template: string, member: { name: string | null; phone: string | null; email: string | null }): string {
  const fullName = (member.name ?? '').trim();
  const parts = fullName.split(/\s+/);
  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ');
  return template
    .replace(/\{%?first_name%?\}/gi, firstName)
    .replace(/\{%?last_name%?\}/gi, lastName)
    .replace(/\{%?full_name%?\}/gi, fullName)
    .replace(/\{%?phone%?\}/gi, member.phone ?? '')
    .replace(/\{%?email%?\}/gi, member.email ?? '');
}

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// GET /api/contact-groups
router.get('/', checkPermission('contact_groups:read'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.user!;
    const result = await query(
      `SELECT cg.*,
        COUNT(cgm.id)::int AS member_count,
        u.name AS created_by_name
       FROM contact_groups cg
       LEFT JOIN contact_group_members cgm ON cgm.group_id = cg.id
       LEFT JOIN users u ON u.id = cg.created_by
       WHERE cg.tenant_id = $1::uuid
       GROUP BY cg.id, u.name
       ORDER BY cg.created_at DESC`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/contact-groups/filter-count — preview count with no group ID (used by create modal)
router.post('/filter-count', checkPermission('contact_groups:read'), async (req: AuthRequest, res: Response) => {
  const { pipeline_id, stage_id, tags, source, date_from, date_to } = req.body;
  try {
    const { tenantId } = req.user!;
    const params: any[] = [tenantId];
    let where = `WHERE l.tenant_id = $1::uuid AND l.is_deleted = FALSE`;
    if (pipeline_id)  { params.push(pipeline_id);  where += ` AND l.pipeline_id = $${params.length}::uuid`; }
    if (stage_id)     { params.push(stage_id);     where += ` AND l.stage_id = $${params.length}::uuid`; }
    if (tags?.length) { params.push(tags);          where += ` AND l.tags && $${params.length}::text[]`; }
    if (source)       { params.push(source);        where += ` AND l.source = $${params.length}`; }
    if (date_from)    { params.push(date_from);     where += ` AND l.created_at >= $${params.length}`; }
    if (date_to)      { params.push(date_to);       where += ` AND l.created_at <= ($${params.length}::date + interval '1 day')`; }
    const result = await query(`SELECT COUNT(*)::int AS count FROM leads l ${where}`, params);
    res.json({ count: result.rows[0].count });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/contact-groups
router.post('/', checkPermission('contact_groups:manage'), async (req: AuthRequest, res: Response) => {
  const { name, description = '', color = '#ea580c' } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'Name required' }); return; }
  try {
    const { tenantId, userId } = req.user!;
    const result = await query(
      `INSERT INTO contact_groups (tenant_id, name, description, color, created_by)
       VALUES ($1::uuid, $2, $3, $4, $5::uuid)
       RETURNING *, 0 AS member_count`,
      [tenantId, name.trim(), description.trim(), color, userId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/contact-groups/:id
router.patch('/:id', checkPermission('contact_groups:manage'), async (req: AuthRequest, res: Response) => {
  const { name, description, color } = req.body;
  const fields: string[] = [];
  const params: any[] = [];
  if (name        !== undefined) { params.push(name.trim());        fields.push(`name=$${params.length}`); }
  if (description !== undefined) { params.push(description.trim()); fields.push(`description=$${params.length}`); }
  if (color       !== undefined) { params.push(color);              fields.push(`color=$${params.length}`); }
  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  fields.push('updated_at=NOW()');
  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE contact_groups SET ${fields.join(',')}
       WHERE id=$${params.length - 1}::uuid AND tenant_id=$${params.length}::uuid
       RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/contact-groups/:id
router.delete('/:id', checkPermission('contact_groups:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query(
      `DELETE FROM contact_groups WHERE id=$1::uuid AND tenant_id=$2::uuid`,
      [req.params.id, req.user!.tenantId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/contact-groups/:id/members
router.get('/:id/members', checkPermission('contact_groups:read'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.user!;
    const grp = await query(
      `SELECT id FROM contact_groups WHERE id=$1::uuid AND tenant_id=$2::uuid`,
      [req.params.id, tenantId]
    );
    if (!grp.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    const result = await query(
      `SELECT cgm.id, cgm.lead_id, cgm.added_by, cgm.added_at,
        l.name AS lead_name, l.email, l.phone, l.source, l.status, l.tags,
        u.name AS assigned_name,
        p.name AS pipeline_name,
        ps.name AS stage_name
       FROM contact_group_members cgm
       JOIN leads l ON l.id = cgm.lead_id AND l.is_deleted = FALSE
       LEFT JOIN users u ON u.id = l.assigned_to
       LEFT JOIN pipelines p ON p.id = l.pipeline_id
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       WHERE cgm.group_id = $1::uuid
       ORDER BY cgm.added_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/contact-groups/:id/members — manual add (array of lead IDs)
router.post('/:id/members', checkPermission('contact_groups:manage'), async (req: AuthRequest, res: Response) => {
  const { lead_ids, added_by = 'manual' } = req.body;
  if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
    res.status(400).json({ error: 'lead_ids array required' }); return;
  }
  try {
    const { tenantId } = req.user!;
    const grp = await query(
      `SELECT id FROM contact_groups WHERE id=$1::uuid AND tenant_id=$2::uuid`,
      [req.params.id, tenantId]
    );
    if (!grp.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    let added = 0;
    for (const leadId of lead_ids) {
      const r = await query(
        `INSERT INTO contact_group_members (group_id, lead_id, added_by)
         VALUES ($1::uuid, $2::uuid, $3)
         ON CONFLICT (group_id, lead_id) DO NOTHING`,
        [req.params.id, leadId, added_by]
      );
      if ((r.rowCount ?? 0) > 0) {
        added++;
        const leadRow = await query(
          `SELECT * FROM leads WHERE id=$1::uuid AND tenant_id=$2::uuid AND is_deleted=FALSE`,
          [leadId, tenantId]
        );
        if (leadRow.rows[0] && tenantId) {
          setImmediate(() =>
            triggerWorkflows('contact_group_added', leadRow.rows[0], tenantId!, req.user!.userId, {
              triggerContext: { group_id: req.params.id },
            }).catch(() => null)
          );
        }
      }
    }
    res.json({ added });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/contact-groups/:id/members/filter — add by pipeline/stage/tags/source/date
router.post('/:id/members/filter', checkPermission('contact_groups:manage'), async (req: AuthRequest, res: Response) => {
  const { pipeline_id, stage_id, tags, source, date_from, date_to, preview = false } = req.body;
  try {
    const { tenantId } = req.user!;
    const grp = await query(
      `SELECT id FROM contact_groups WHERE id=$1::uuid AND tenant_id=$2::uuid`,
      [req.params.id, tenantId]
    );
    if (!grp.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }

    const params: any[] = [tenantId];
    let where = `WHERE l.tenant_id = $1::uuid AND l.is_deleted = FALSE`;
    if (pipeline_id)   { params.push(pipeline_id);         where += ` AND l.pipeline_id = $${params.length}::uuid`; }
    if (stage_id)      { params.push(stage_id);            where += ` AND l.stage_id = $${params.length}::uuid`; }
    if (tags?.length)  { params.push(tags);                where += ` AND l.tags && $${params.length}::text[]`; }
    if (source)        { params.push(source);              where += ` AND l.source = $${params.length}`; }
    if (date_from)     { params.push(date_from);           where += ` AND l.created_at >= $${params.length}`; }
    if (date_to)       { params.push(date_to);             where += ` AND l.created_at <= ($${params.length}::date + interval '1 day')`; }

    if (preview) {
      const count = await query(`SELECT COUNT(*)::int AS count FROM leads l ${where}`, params);
      res.json({ count: count.rows[0].count });
      return;
    }

    const leads = await query(`SELECT l.* FROM leads l ${where} LIMIT 5000`, params);
    let added = 0;
    for (const lead of leads.rows) {
      const r = await query(
        `INSERT INTO contact_group_members (group_id, lead_id, added_by)
         VALUES ($1::uuid, $2::uuid, 'filter')
         ON CONFLICT (group_id, lead_id) DO NOTHING`,
        [req.params.id, lead.id]
      );
      if ((r.rowCount ?? 0) > 0) {
        added++;
        if (tenantId) {
          const gid = req.params.id;
          const leadSnap = { ...lead };
          setImmediate(() =>
            triggerWorkflows('contact_group_added', leadSnap, tenantId!, req.user!.userId, {
              triggerContext: { group_id: gid },
            }).catch(() => null)
          );
        }
      }
    }
    res.json({ added, total: leads.rows.length });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/contact-groups/:id/members/bulk-remove — remove multiple members at once
router.post('/:id/members/bulk-remove', checkPermission('contact_groups:manage'), async (req: AuthRequest, res: Response) => {
  const { lead_ids } = req.body;
  if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
    res.status(400).json({ error: 'lead_ids array required' }); return;
  }
  try {
    const { tenantId } = req.user!;
    const grp = await query(
      `SELECT id FROM contact_groups WHERE id=$1::uuid AND tenant_id=$2::uuid`,
      [req.params.id, tenantId]
    );
    if (!grp.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    const result = await query(
      `DELETE FROM contact_group_members
       WHERE group_id = $1::uuid AND lead_id = ANY($2::uuid[])`,
      [req.params.id, lead_ids]
    );
    res.json({ removed: result.rowCount ?? 0 });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/contact-groups/:id/members/:leadId
router.delete('/:id/members/:leadId', checkPermission('contact_groups:manage'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.user!;
    const grp = await query(
      `SELECT id FROM contact_groups WHERE id=$1::uuid AND tenant_id=$2::uuid`,
      [req.params.id, tenantId]
    );
    if (!grp.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    await query(
      `DELETE FROM contact_group_members WHERE group_id=$1::uuid AND lead_id=$2::uuid`,
      [req.params.id, req.params.leadId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/contact-groups/:id/broadcast — send WhatsApp or email to all members
router.post('/:id/broadcast', checkPermission('contact_groups:manage'), async (req: AuthRequest, res: Response) => {
  const { type, message, subject, template_id, template_params } = req.body;
  if (!type || !['whatsapp', 'email'].includes(type)) {
    res.status(400).json({ error: 'type must be "whatsapp" or "email"' }); return;
  }
  if (!template_id && !message?.trim()) {
    res.status(400).json({ error: 'message is required' }); return;
  }
  if (type === 'email' && !subject?.trim()) {
    res.status(400).json({ error: 'subject is required for email broadcast' }); return;
  }

  try {
    const { tenantId } = req.user!;
    const grp = await query(
      `SELECT id, name FROM contact_groups WHERE id=$1::uuid AND tenant_id=$2::uuid`,
      [req.params.id, tenantId]
    );
    if (!grp.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }

    // Fetch members with phone + email
    const membersRes = await query(
      `SELECT l.id, l.name, l.phone, l.email
       FROM contact_group_members cgm
       JOIN leads l ON l.id = cgm.lead_id AND l.is_deleted = FALSE
       WHERE cgm.group_id = $1::uuid`,
      [req.params.id]
    );
    const members = membersRes.rows;
    const total = members.length;
    let sent = 0, failed = 0, skipped = 0;
    const errors: string[] = [];

    if (type === 'whatsapp') {
      const wabaRes = await query(
        `SELECT phone_number_id, access_token FROM waba_integrations
         WHERE tenant_id=$1::uuid AND is_active=TRUE LIMIT 1`,
        [tenantId]
      );
      if (!wabaRes.rows[0]) {
        res.status(400).json({ error: 'WhatsApp (WABA) integration not configured or inactive' }); return;
      }
      const { phone_number_id, access_token: encToken } = wabaRes.rows[0];
      const waToken = decrypt(encToken);

      // Resolve template if provided
      let tplMeta: { meta_name: string; language: string } | null = null;
      if (template_id) {
        const tplRes = await query(
          'SELECT meta_name, language FROM templates WHERE id=$1::uuid AND tenant_id=$2::uuid',
          [template_id, tenantId],
        );
        if (tplRes.rows[0]?.meta_name) tplMeta = tplRes.rows[0];
      }

      for (const m of members) {
        if (!m.phone) { skipped++; continue; }
        try {
          let resp: any;
          if (tplMeta) {
            // Build per-member parameters by interpolating param values
            const rawParams = (template_params ?? []) as Array<{ type: string; parameters: Array<{ type: string; text?: string }> }>;
            const resolvedComps = rawParams.map((comp) => ({
              type: comp.type,
              parameters: (comp.parameters ?? []).map((p) => ({
                type: 'text' as const,
                text: interpolateBroadcast(p.text ?? '', m),
              })),
            }));
            resp = await sendWATemplate(phone_number_id, waToken, m.phone, tplMeta.meta_name, tplMeta.language ?? 'en', resolvedComps);
          } else {
            resp = await sendWAText(phone_number_id, waToken, m.phone, interpolateBroadcast(message.trim(), m));
          }
          if (resp?.error) {
            failed++;
            errors.push(`${m.name}: ${resp.error.message}`);
          } else {
            sent++;
          }
        } catch (err: any) {
          failed++;
          errors.push(`${m.name}: ${err.message}`);
        }
      }
    } else {
      // email
      const bcastIdent = await getTenantEmailIdentity(tenantId);
      for (const m of members) {
        if (!m.email) { skipped++; continue; }
        try {
          const interpolated = interpolateBroadcast(message.trim(), m);
          await sendEmail({
            to: m.email,
            subject: subject.trim(),
            fromName: bcastIdent.fromName,
            replyTo: bcastIdent.replyTo,
            tenantId: tenantId || undefined,
            html: interpolated.replace(/\n/g, '<br>'),
            text: interpolated,
          });
          sent++;
        } catch (err: any) {
          failed++;
          errors.push(`${m.name}: ${err.message}`);
        }
      }
    }

    res.json({ sent, failed, skipped, total, errors: errors.slice(0, 20) });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

export default router;
