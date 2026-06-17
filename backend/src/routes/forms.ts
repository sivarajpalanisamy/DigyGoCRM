import { Router, Request, Response } from 'express';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';
import { checkUsage, incrementUsage } from '../middleware/plan';
import { triggerWorkflows } from './workflows';
import { upsertContact } from '../utils/contacts';
import { emitToTenant } from '../socket';
import { sendNewLeadNotification } from '../utils/notifications';
import { backfillCustomFields } from '../utils/customFields';

const router = Router();

// Auth + tenant context required for all routes EXCEPT /:id/submit (#44)
router.use((req, res, next) => {
  if (req.method === 'POST' && req.path.endsWith('/submit')) return next();
  return requireAuth(req as AuthRequest, res, (err?: any) => {
    if (err) return next(err);
    return requireTenant(req as AuthRequest, res, next);
  });
});

// ── Custom Forms ──────────────────────────────────────────────────────────────

// GET /api/forms — list all forms for tenant
router.get('/', checkPermission('custom_forms:read'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT f.*,
              p.name AS pipeline_name,
              ps.name AS stage_name,
              COUNT(s.id)::int AS submission_count
       FROM custom_forms f
       LEFT JOIN pipelines p ON p.id = f.pipeline_id
       LEFT JOIN pipeline_stages ps ON ps.id = f.stage_id
       LEFT JOIN form_submissions s ON s.form_id = f.id
       WHERE f.tenant_id = $1 AND f.is_active = TRUE
       GROUP BY f.id, p.name, ps.name
       ORDER BY f.created_at DESC`,
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch (err: any) {
    if (err.code === '42P01' || err.code === '42703') { res.json([]); return; } // table/column missing
    console.error('[forms GET /]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/forms/:id — get single form with pipeline/stage names and submission count
router.get('/:id', checkPermission('custom_forms:read'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT f.*, p.name AS pipeline_name, ps.name AS stage_name,
              COUNT(s.id)::int AS submission_count
       FROM custom_forms f
       LEFT JOIN pipelines p ON p.id = f.pipeline_id
       LEFT JOIN pipeline_stages ps ON ps.id = f.stage_id
       LEFT JOIN form_submissions s ON s.form_id = f.id
       WHERE f.id = $1 AND f.tenant_id = $2
       GROUP BY f.id, p.name, ps.name`,
      [req.params.id, req.user!.tenantId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Form not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/forms — create form with auto-generated slug
router.post('/', checkPermission('custom_forms:create'), checkUsage('forms'), async (req: AuthRequest, res: Response) => {
  const {
    name, fields, pipeline_id, stage_id,
    submit_label, redirect_url, thank_you_message,
    btn_color, btn_text_color, form_bg_color, form_text_color,
    declaration_enabled, declaration_title, declaration_link,
  } = req.body;
  if (!name) { res.status(400).json({ error: 'Form name required' }); return; }

  const tenantId = req.user!.tenantId;

  try {
    // Auto-generate globally unique slug (across all tenants — slugs are shared URL namespace)
    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    let candidate = slug;
    let n = 1;
    while (true) {
      const chk = await query(
        'SELECT id FROM custom_forms WHERE slug=$1',
        [candidate]
      );
      if (!chk.rows.length) { slug = candidate; break; }
      n++;
      candidate = `${slug}-${n}`;
    }

    const result = await query(
      `INSERT INTO custom_forms
         (tenant_id, name, slug, fields, pipeline_id, stage_id,
          submit_label, redirect_url, thank_you_message,
          btn_color, btn_text_color, form_bg_color, form_text_color,
          declaration_enabled, declaration_title, declaration_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        tenantId, name, slug, JSON.stringify(fields ?? []),
        pipeline_id ?? null, stage_id ?? null,
        submit_label ?? 'Submit',
        redirect_url ?? null,
        thank_you_message ?? 'Thank you for your submission!',
        btn_color ?? '#ea580c',
        btn_text_color ?? '#ffffff',
        form_bg_color ?? '#ffffff',
        form_text_color ?? '#1c1410',
        declaration_enabled ?? false,
        declaration_title ?? null,
        declaration_link ?? null,
      ]
    );
    res.status(201).json(result.rows[0]);
    setImmediate(() => incrementUsage(tenantId!, 'forms').catch(() => null));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/forms/:id — update form (all columns)
router.patch('/:id', checkPermission('custom_forms:edit'), async (req: AuthRequest, res: Response) => {
  const {
    name, fields, pipeline_id, stage_id, is_active,
    submit_label, redirect_url, thank_you_message,
    btn_color, btn_text_color, form_bg_color, form_text_color,
    declaration_enabled, declaration_title, declaration_link,
  } = req.body;
  try {
    const result = await query(
      `UPDATE custom_forms SET
         name=$1, fields=$2, pipeline_id=$3, stage_id=$4, is_active=$5,
         submit_label=$6, redirect_url=$7, thank_you_message=$8,
         btn_color=$9, btn_text_color=$10, form_bg_color=$11, form_text_color=$12,
         declaration_enabled=$13, declaration_title=$14, declaration_link=$15
       WHERE id=$16 AND tenant_id=$17
       RETURNING *`,
      [
        name, JSON.stringify(fields), pipeline_id ?? null, stage_id ?? null,
        is_active ?? true,
        submit_label ?? 'Submit',
        redirect_url ?? null,
        thank_you_message ?? 'Thank you for your submission!',
        btn_color ?? '#ea580c',
        btn_text_color ?? '#ffffff',
        form_bg_color ?? '#ffffff',
        form_text_color ?? '#1c1410',
        declaration_enabled ?? false,
        declaration_title ?? null,
        declaration_link ?? null,
        req.params.id, req.user!.tenantId,
      ]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Form not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/forms/:id — soft delete if has submissions, hard delete otherwise
router.delete('/:id', checkPermission('custom_forms:delete'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;
  try {
    const subCount = await query(
      'SELECT COUNT(*) FROM form_submissions WHERE form_id=$1',
      [id]
    );
    if (Number(subCount.rows[0].count) > 0) {
      // soft delete
      await query(
        'UPDATE custom_forms SET is_active=FALSE WHERE id=$1 AND tenant_id=$2',
        [id, tenantId]
      );
    } else {
      await query(
        'DELETE FROM custom_forms WHERE id=$1 AND tenant_id=$2',
        [id, tenantId]
      );
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── Submissions ───────────────────────────────────────────────────────────────

// GET /api/forms/:id/submissions
router.get('/:id/submissions', checkPermission('custom_forms:read'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM form_submissions WHERE form_id=$1 AND tenant_id=$2 ORDER BY submitted_at DESC`,
      [req.params.id, req.user!.tenantId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/forms/:id/embed — returns share link + embed codes
router.get('/:id/embed', checkPermission('custom_forms:read'), async (req: AuthRequest, res: Response) => {
  try {
    const formRes = await query(
      'SELECT slug FROM custom_forms WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.user!.tenantId]
    );
    const form = formRes.rows[0];
    if (!form) { res.status(404).json({ error: 'Form not found' }); return; }

    const publicUrl = process.env.PUBLIC_URL ?? process.env.VITE_PUBLIC_URL ?? 'http://localhost:5173';
    const shareLink = `${publicUrl}/f/${form.slug}`;
    const iframeCode = `<iframe src="${shareLink}" width="100%" height="700" frameborder="0" style="border:none;border-radius:16px;max-width:480px;margin:0 auto;display:block;"></iframe>`;
    const scriptCode = `<div id="dgform-${form.slug}"></div>
<script>
(function(){
  var d=document,s="${shareLink}",c=d.getElementById("dgform-${form.slug}");
  if(!c)return;
  var f=d.createElement("iframe");
  f.src=s;f.width="100%";f.height="700";f.frameBorder="0";
  f.style.cssText="border:none;border-radius:16px;max-width:480px;display:block;margin:0 auto;";
  c.appendChild(f);
})();
</script>`;
    res.json({ shareLink, iframeCode, scriptCode });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Public: POST /api/forms/:id/submit (no auth — accepts form UUID or slug)
router.post('/:id/submit', async (req: AuthRequest, res: Response) => {
  const { data } = req.body as { data: Record<string, string> };
  try {
    const idOrSlug = req.params.id;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const formRes = await query(
      isUUID
        ? `SELECT * FROM custom_forms WHERE (id=$1::uuid OR slug=$1::text) AND is_active=TRUE LIMIT 1`
        : `SELECT * FROM custom_forms WHERE slug=$1 AND is_active=TRUE LIMIT 1`,
      [idOrSlug]
    );
    const form = formRes.rows[0];
    if (!form) { res.status(404).json({ error: 'Form not found or inactive' }); return; }

    // Block submissions to forms owned by suspended tenants (#50)
    const tenantCheck = await query(
      `SELECT is_active FROM tenants WHERE id=$1`,
      [form.tenant_id]
    );
    if (!tenantCheck.rows[0]?.is_active) {
      res.status(404).json({ error: 'Form not found or inactive' }); return;
    }

    await query(
      `INSERT INTO form_submissions (form_id, tenant_id, data) VALUES ($1,$2,$3)`,
      [form.id, form.tenant_id, JSON.stringify(data)]
    );

    // Normalize field values — form field keys vary (name/full_name/Name etc.)
    const findField = (keys: string[]) => {
      for (const k of keys) {
        const match = Object.entries(data ?? {}).find(([key]) => key.toLowerCase() === k.toLowerCase());
        if (match?.[1]) return match[1];
      }
      return undefined;
    };
    const name  = findField(['name', 'full_name', 'fullname', 'contact_name']);
    const email = findField(['email', 'email_address']);
    const phone = findField(['phone', 'mobile', 'phone_number', 'mobile_number', 'contact_number']);

    if (name) {
      // Dedup: check if a lead with this phone or email already exists for this tenant
      let existingLead: any = null;
      if (phone) {
        const ex = await query(
          `SELECT * FROM leads WHERE tenant_id=$1 AND phone=$2 AND is_deleted=FALSE LIMIT 1`,
          [form.tenant_id, phone]
        );
        existingLead = ex.rows[0] ?? null;
      }
      if (!existingLead && email) {
        const ex = await query(
          `SELECT * FROM leads WHERE tenant_id=$1 AND email=$2 AND is_deleted=FALSE LIMIT 1`,
          [form.tenant_id, email]
        );
        existingLead = ex.rows[0] ?? null;
      }

      let lead: any;
      if (existingLead) {
        // Update existing lead with any new info from the form
        const updates: string[] = ['updated_at=NOW()', `source='Custom Form'`];
        const vals: any[] = [];
        if (email && !existingLead.email) { vals.push(email); updates.push(`email=$${vals.length}`); }
        if (phone && !existingLead.phone) { vals.push(phone); updates.push(`phone=$${vals.length}`); }
        if (form.pipeline_id && !existingLead.pipeline_id) {
          vals.push(form.pipeline_id); updates.push(`pipeline_id=$${vals.length}`);
          if (form.stage_id) { vals.push(form.stage_id); updates.push(`stage_id=$${vals.length}`); }
        }
        vals.push(existingLead.id, form.tenant_id);
        const upRes = await query(
          `UPDATE leads SET ${updates.join(',')} WHERE id=$${vals.length - 1} AND tenant_id=$${vals.length} RETURNING *`,
          vals
        );
        lead = upRes.rows[0];
        emitToTenant(form.tenant_id, 'lead:updated', lead);
      } else {
        // Insert new lead — pipeline_id may be null if form has no pipeline configured
        const insRes = await query(
          `INSERT INTO leads (tenant_id, name, email, phone, source, custom_form_id, pipeline_id, stage_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [form.tenant_id, name, email ?? null, phone ?? null, `form:${form.name}`, form.id, form.pipeline_id ?? null, form.stage_id ?? null]
        );
        lead = insRes.rows[0];
        emitToTenant(form.tenant_id, 'lead:created', lead);
        sendNewLeadNotification(form.tenant_id, lead, null).catch(() => null);
      }

      // Extract custom fields from form field mapTo mappings and persist them
      // so enrichLead() can include them in trigger conditions + variable interpolation
      const STANDARD = new Set(['first_name', 'last_name', 'name', 'full_name', 'email', 'phone']);
      const formFields: Array<{ mapTo: string; label: string }> = form.fields ?? [];
      const customFieldsData: Record<string, string> = {};
      for (const field of formFields) {
        if (!field.mapTo || STANDARD.has(field.mapTo)) continue;
        const value = String(data[field.label] ?? data[field.mapTo] ?? '').trim();
        if (value) customFieldsData[field.mapTo] = value;
      }
      if (Object.keys(customFieldsData).length > 0) {
        await backfillCustomFields(lead.id, form.tenant_id, customFieldsData);
      }

      const leadWithForm = { ...lead, form_id: form.id, form_name: form.name };
      setImmediate(() => {
        upsertContact(form.tenant_id, lead.name, lead.email, lead.phone, lead.id).catch(() => null);
        triggerWorkflows('opt_in_form', leadWithForm, form.tenant_id, '').catch(() => null);
        triggerWorkflows('lead_created', leadWithForm, form.tenant_id, '').catch(() => null);
      });
    }

    res.json({ success: true, message: form.thank_you_message ?? 'Thank you for your submission!' });
  } catch (err: any) {
    console.error('[forms submit]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
