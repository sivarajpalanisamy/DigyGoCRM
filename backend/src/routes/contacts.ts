import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission, hasPermission } from '../middleware/permissions';
import { checkUsage, incrementUsage } from '../middleware/plan';
import { triggerWorkflows } from './workflows';
import * as XLSX from 'xlsx';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// GET /api/contacts
router.get('/', checkPermission('contacts:read'), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, tenantId, role } = req.user!;
    const isSuperAdmin = role === 'super_admin';

    let onlyAssigned = false;
    if (!isSuperAdmin) {
      let isOwner = false;
      try { isOwner = (await query('SELECT is_owner FROM users WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)', [userId, tenantId])).rows[0]?.is_owner === true; } catch { isOwner = false; }
      if (!isOwner) {
        try { onlyAssigned = await hasPermission(userId, 'leads:only_assigned', tenantId); } catch { onlyAssigned = true; }
      }
    }

    const params: any[] = [tenantId];
    let assignedFilter = '';
    if (onlyAssigned) {
      params.push(userId);
      assignedFilter = ` AND l.assigned_to = $${params.length}`;
    }

    const result = await query(
      `SELECT c.*, l.name AS lead_name, l.tags FROM contacts c
       LEFT JOIN leads l ON l.id = c.lead_id
       WHERE c.tenant_id = $1${assignedFilter} ORDER BY c.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/contacts/export
const CONTACT_FIELDS: Record<string, string> = {
  name: 'Name', email: 'Email', phone: 'Phone', company: 'Company',
  tags: 'Tags', created_at: 'Created At',
  source: 'Source',
  lead_status: 'Lead Status',
  assigned_name: 'Assigned To',
  pipeline_name: 'Pipeline',
  stage_name: 'Stage',
  lead_quality: 'Lead Quality',
  deal_value: 'Deal Value',
  last_activity: 'Last Activity',
  next_followup_date: 'Next Follow-up Date',
  followup_status: 'Follow-up Status',
  team_member_names: 'Team Members',
  lead_updated_at: 'Last Updated',
  notes: 'Notes',
};

router.get('/export', checkPermission('contacts:export'), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, tenantId, role } = req.user!;
    const { fields = '', format = 'xlsx', source, tag, pipeline_id, stage_id, type, date_from, date_to, ids } = req.query as Record<string, string>;
    const isSuperAdmin = role === 'super_admin';

    let onlyAssigned = false;
    if (!isSuperAdmin) {
      try { onlyAssigned = await hasPermission(userId, 'leads:only_assigned', tenantId); } catch { onlyAssigned = true; }
    }

    const params: any[] = [tenantId];
    let extraFilter = '';
    if (onlyAssigned) {
      params.push(userId);
      extraFilter += ` AND (l.assigned_to = $${params.length}::uuid OR $${params.length}::uuid = ANY(l.team_members))`;
    }
    if (source) {
      params.push(source);
      extraFilter += ` AND l.source = $${params.length}`;
    }
    if (tag) {
      params.push(tag);
      extraFilter += ` AND $${params.length} = ANY(l.tags)`;
    }
    if (pipeline_id === '__none__') {
      extraFilter += ` AND l.pipeline_id IS NULL`;
    } else if (pipeline_id) {
      params.push(pipeline_id);
      extraFilter += ` AND l.pipeline_id = $${params.length}::uuid`;
    }
    if (stage_id) {
      params.push(stage_id);
      extraFilter += ` AND l.stage_id = $${params.length}::uuid`;
    }
    if (type === 'Customer') {
      extraFilter += ` AND ps.name = 'Closed Won'`;
    } else if (type === 'Lead') {
      extraFilter += ` AND (ps.name IS NULL OR ps.name <> 'Closed Won')`;
    }
    if (date_from) {
      params.push(date_from);
      extraFilter += ` AND c.created_at >= $${params.length}::date`;
    }
    if (date_to) {
      params.push(date_to);
      extraFilter += ` AND c.created_at < ($${params.length}::date + INTERVAL '1 day')`;
    }
    if (ids) {
      const idArr = ids.split(',').filter(Boolean);
      if (idArr.length > 0) {
        params.push(idArr);
        extraFilter += ` AND c.lead_id = ANY($${params.length}::uuid[])`;
      }
    }

    const result = await query(
      `SELECT c.*,
        l.tags,
        l.source,
        l.status AS lead_status,
        l.deal_value,
        l.updated_at AS lead_updated_at,
        l.custom_fields->>'lead_quality' AS lead_quality,
        u.name AS assigned_name,
        p.name AS pipeline_name,
        ps.name AS stage_name,
        l.updated_at AS last_activity,
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
           COALESCE(NULLIF(TRIM(n.title), '') || ' — ', '') || COALESCE(n.content, ''),
           E'\n' ORDER BY n.created_at ASC
         ) FROM lead_notes n LEFT JOIN users un ON un.id = n.created_by WHERE n.lead_id = l.id) AS notes
       FROM contacts c
       LEFT JOIN leads l ON l.id = c.lead_id AND l.is_deleted = FALSE
       LEFT JOIN users u ON u.id = l.assigned_to
       LEFT JOIN pipelines p ON p.id = l.pipeline_id
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       WHERE c.tenant_id = $1${extraFilter}
       ORDER BY c.created_at DESC LIMIT 10000`,
      params
    );

    const selectedFields = fields ? fields.split(',').filter((f) => CONTACT_FIELDS[f]) : Object.keys(CONTACT_FIELDS);

    const SOURCE_LABELS: Record<string, string> = {
      manual: 'Manual',
      meta_form: 'Meta Form',
      custom_form: 'Custom Form',
      calendar_booking: 'Calendar Booking',
      whatsapp: 'WhatsApp',
      api: 'API',
      import: 'Import',
      landing_page: 'Landing Page',
      referral: 'Referral',
      website: 'Website',
      phone_call: 'Phone Call',
      email: 'Email',
      social_media: 'Social Media',
      paid_ad: 'Paid Ad',
      event: 'Event',
    };

    const QUALITY_LABELS: Record<string, string> = {
      hot: 'Hot', warm: 'Warm', cold: 'Cold', unqualified: 'Unqualified',
    };

    const STATUS_LABELS: Record<string, string> = {
      new: 'New', active: 'Active', contacted: 'Contacted',
      qualified: 'Qualified', converted: 'Converted', lost: 'Lost',
    };

    const sheetData = result.rows.map((row: any) => {
      const out: Record<string, any> = {};
      for (const f of selectedFields) {
        let val = row[f];
        if (f === 'tags' && Array.isArray(val)) val = val.join(', ');
        if ((f === 'created_at' || f === 'lead_updated_at' || f === 'last_activity') && val)
          val = new Date(val).toLocaleString();
        if (f === 'next_followup_date' && val)
          val = new Date(val).toLocaleString();
        if (f === 'deal_value' && val !== null && val !== undefined)
          val = Number(val);
        if (f === 'source' && val)
          val = SOURCE_LABELS[val] ?? val.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        if (f === 'lead_quality' && val)
          val = QUALITY_LABELS[val] ?? val;
        if (f === 'lead_status' && val)
          val = STATUS_LABELS[val] ?? val;
        out[CONTACT_FIELDS[f]] = (val !== null && val !== undefined && val !== '') ? val : 'No data';
      }
      return out;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');

    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
      res.setHeader('Content-Type', 'text/csv');
      res.send(csv);
    } else {
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', 'attachment; filename="contacts.xlsx"');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buf);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// POST /api/contacts
router.post('/', checkPermission('contacts:create'), checkUsage('contacts'), async (req: AuthRequest, res: Response) => {
  const { name, email, phone, company, lead_id } = req.body;
  if (!name) { res.status(400).json({ error: 'Name required' }); return; }
  try {
    const result = await query(
      `INSERT INTO contacts (tenant_id, name, email, phone, company, lead_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user!.tenantId, name, email, phone, company, lead_id]
    );
    const contact = result.rows[0];
    res.status(201).json(contact);
    const lead = { id: contact.lead_id, name: contact.name, email: contact.email, phone: contact.phone };
    const source = (req.body.source as string) ?? 'Manual';
    setImmediate(() => {
      incrementUsage(req.user!.tenantId!, 'contacts').catch(() => null);
      triggerWorkflows('contact_created', lead, req.user!.tenantId!, req.user!.userId,
        { triggerContext: { source } }
      ).catch(() => null);
    });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/contacts/:id
router.patch('/:id', checkPermission('contacts:edit'), async (req: AuthRequest, res: Response) => {
  const { name, email, phone, company } = req.body;

  const fields: string[] = [];
  const params: any[] = [];
  if (name    !== undefined) { params.push(name);    fields.push(`name=$${params.length}`); }
  if (email   !== undefined) { params.push(email);   fields.push(`email=$${params.length}`); }
  if (phone   !== undefined) { params.push(phone);   fields.push(`phone=$${params.length}`); }
  if (company !== undefined) { params.push(company); fields.push(`company=$${params.length}`); }
  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE contacts SET ${fields.join(',')} WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    const contact = result.rows[0];
    res.json(contact);
    const leadCtx = { id: contact.lead_id ?? contact.id, name: contact.name, email: contact.email, phone: contact.phone };
    const changedField = ['name','email','phone','company'].find((k) => req.body[k] !== undefined) ?? '';
    setImmediate(() => triggerWorkflows('contact_updated', leadCtx, req.user!.tenantId!, req.user!.userId,
      { triggerContext: { fieldChanged: changedField } }
    ).catch(() => null));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/contacts/:id
router.delete('/:id', checkPermission('contacts:delete'), async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM contacts WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user!.tenantId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/contacts/:id/journey — full enquiry journey for a contact
router.get('/:id/journey', checkPermission('contacts:read'), async (req: AuthRequest, res: Response) => {
  try {
    // Get contact's phone and email
    const contactRes = await query(
      'SELECT phone, email FROM contacts WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.user!.tenantId]
    );
    if (!contactRes.rows[0]) { res.status(404).json({ error: 'Contact not found' }); return; }
    const { phone, email } = contactRes.rows[0];

    if (!phone && !email) { res.json({ enquiries: [], leads: [] }); return; }

    // Fetch all enquiry log entries for this phone/email
    const params: any[] = [req.user!.tenantId];
    const conditions: string[] = [];
    if (email) { params.push(email.toLowerCase()); conditions.push(`LOWER(el.email)=$${params.length}`); }
    if (phone) { params.push(phone); conditions.push(`el.phone=$${params.length}`); }

    const enquiries = await query(
      `SELECT el.* FROM enquiry_log el
       WHERE el.tenant_id=$1 AND (${conditions.join(' OR ')})
       ORDER BY el.created_at DESC`,
      params
    );

    // Fetch all leads for this person across pipelines
    const leadParams: any[] = [req.user!.tenantId];
    const leadConditions: string[] = [];
    if (email) { leadParams.push(email.toLowerCase()); leadConditions.push(`LOWER(l.email)=$${leadParams.length}`); }
    if (phone) { leadParams.push(phone); leadConditions.push(`l.phone=$${leadParams.length}`); }

    const leads = await query(
      `SELECT l.id, l.name, l.email, l.phone, l.source, l.pipeline_id, l.stage_id, l.status,
              l.created_at, l.updated_at, l.deal_value,
              l.custom_fields->>'lead_quality' AS lead_quality,
              p.name AS pipeline_name, ps.name AS stage_name,
              u.name AS assigned_name
       FROM leads l
       LEFT JOIN pipelines p ON p.id = l.pipeline_id
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.tenant_id=$1 AND l.is_deleted=FALSE AND (${leadConditions.join(' OR ')})
       ORDER BY l.created_at DESC`,
      leadParams
    );

    res.json({ enquiries: enquiries.rows, leads: leads.rows });
  } catch (err: any) {
    console.error('[contact journey]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/contacts/journey/by-lead/:leadId — enquiry journey from a lead's phone/email
router.get('/journey/by-lead/:leadId', checkPermission('contacts:read'), async (req: AuthRequest, res: Response) => {
  try {
    const leadRes = await query(
      'SELECT phone, email FROM leads WHERE id=$1::uuid AND tenant_id=$2 AND is_deleted=FALSE',
      [req.params.leadId, req.user!.tenantId]
    );
    if (!leadRes.rows[0]) { res.status(404).json({ error: 'Lead not found' }); return; }
    const { phone, email } = leadRes.rows[0];

    if (!phone && !email) { res.json({ enquiries: [], leads: [] }); return; }

    const params: any[] = [req.user!.tenantId];
    const conditions: string[] = [];
    if (email) { params.push(email.toLowerCase()); conditions.push(`LOWER(el.email)=$${params.length}`); }
    if (phone) { params.push(phone); conditions.push(`el.phone=$${params.length}`); }

    const enquiries = await query(
      `SELECT el.* FROM enquiry_log el
       WHERE el.tenant_id=$1 AND (${conditions.join(' OR ')})
       ORDER BY el.created_at DESC`,
      params
    );

    const leadParams: any[] = [req.user!.tenantId];
    const leadConditions: string[] = [];
    if (email) { leadParams.push(email.toLowerCase()); leadConditions.push(`LOWER(l.email)=$${leadParams.length}`); }
    if (phone) { leadParams.push(phone); leadConditions.push(`l.phone=$${leadParams.length}`); }

    const leads = await query(
      `SELECT l.id, l.name, l.source, l.pipeline_id, l.stage_id,
              l.created_at, p.name AS pipeline_name, ps.name AS stage_name
       FROM leads l
       LEFT JOIN pipelines p ON p.id = l.pipeline_id
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       WHERE l.tenant_id=$1 AND l.is_deleted=FALSE AND (${leadConditions.join(' OR ')})
       ORDER BY l.created_at DESC`,
      leadParams
    );

    res.json({ enquiries: enquiries.rows, leads: leads.rows });
  } catch (err: any) {
    console.error('[lead journey]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
