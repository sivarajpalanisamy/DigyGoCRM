import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { query, pool } from '../db';
import { triggerWorkflows } from './workflows';
import { upsertContact } from '../utils/contacts';
import { emitToTenant } from '../socket';
import { sendNewLeadNotification } from '../utils/notifications';
import { backfillCustomFields } from '../utils/customFields';

// FIX D: Rate limiter for all public booking-link endpoints (30 req / 15 min per IP)
const bookingLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: process.env.NODE_ENV === 'production' ? 30 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

const router = Router();

// GET /api/public/branding?domain=admin.thangapanam.com
// Returns white-label branding for a custom domain — no auth required
router.get('/branding', async (req: Request, res: Response) => {
  const domain = (req.query.domain as string ?? '').trim().toLowerCase();
  if (!domain) { res.status(400).json({ error: 'domain query param required' }); return; }

  // Skip certbot check in local dev mode
  const skipCertbot = process.env.SKIP_CERTBOT === 'true';
  const statusFilter = skipCertbot
    ? "domain_status IN ('ssl_active','dns_pending')"
    : "domain_status = 'ssl_active'";

  try {
    const r = await query(
      `SELECT id, name, logo_url, favicon_url, banner_url, brand_color, login_bg_color, tab_title, app_bg_color, accent_color, reply_to_email
       FROM tenants WHERE custom_domain=$1 AND ${statusFilter} LIMIT 1`,
      [domain]
    );
    if (!r.rows[0]) { res.status(404).json({ error: 'Domain not found' }); return; }
    const t = r.rows[0];
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      name:         t.name,
      logoUrl:      t.logo_url ?? null,
      faviconUrl:   t.favicon_url ?? null,
      bannerUrl:    t.banner_url ?? null,
      brandColor:   t.brand_color ?? '#c2410c',
      loginBgColor: t.login_bg_color ?? null,
      tabTitle:     t.tab_title ?? null,
      appBgColor:   t.app_bg_color ?? null,
      accentColor:  t.accent_color ?? null,
      replyToEmail: t.reply_to_email ?? null,
    });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/public/forms/:slug — return form definition for public render (no auth)
router.get('/forms/:slug', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, fields, submit_label, redirect_url, thank_you_message,
              btn_color, btn_text_color, form_bg_color, form_text_color,
              declaration_enabled, declaration_title, declaration_link
       FROM custom_forms WHERE slug=$1 AND is_active=TRUE ORDER BY created_at ASC LIMIT 1`,
      [req.params.slug]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Form not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/public/forms/:slug/submit — public form submission (no auth)
router.post('/forms/:slug/submit', async (req: Request, res: Response) => {
  const data: Record<string, string> = req.body?.data ?? req.body ?? {};
  try {
    const formRes = await query(
      `SELECT * FROM custom_forms WHERE slug=$1 AND is_active=TRUE ORDER BY created_at ASC LIMIT 1`,
      [req.params.slug]
    );
    const form = formRes.rows[0];
    if (!form) { res.status(404).json({ error: 'Form not found or inactive' }); return; }

    // Extract lead fields from submitted data using field mapTo mappings
    const fields: Array<{ mapTo: string; label: string }> = form.fields ?? [];
    let firstName = '';
    let lastName  = '';
    let name  = '';
    let email = '';
    let phone = '';
    const customFieldsData: Record<string, string> = {};

    for (const field of fields) {
      const value = data[field.label] ?? data[field.mapTo] ?? '';
      if (!value) continue;
      if (field.mapTo === 'first_name') {
        firstName = value;
      } else if (field.mapTo === 'last_name') {
        lastName = value;
      } else if (field.mapTo === 'name' || field.mapTo === 'full_name') {
        name = value;
      } else if (field.mapTo === 'email') {
        email = value.toLowerCase().trim();
      } else if (field.mapTo === 'phone') {
        phone = value.trim();
      } else if (field.mapTo) {
        customFieldsData[field.mapTo] = value;
      }
    }

    // Compose name from parts
    if (!name && (firstName || lastName)) {
      name = [firstName, lastName].filter(Boolean).join(' ');
    }

    // Fallback: try common top-level keys
    if (!name)  name  = data.name ?? data.full_name ?? data['Full Name'] ?? '';
    if (!email) email = (data.email ?? data.Email ?? '').toLowerCase().trim();
    if (!phone) phone = data.phone ?? data.Phone ?? '';

    // Server-side required-field validation
    const requiredFields: Array<{ label: string; mapTo: string; required?: boolean }> = form.fields ?? [];
    const missing: string[] = [];
    for (const field of requiredFields) {
      if (!field.required) continue;
      const val = (data[field.label] ?? data[field.mapTo] ?? '').toString().trim();
      if (!val) missing.push(field.label);
    }
    if (missing.length > 0) {
      res.status(400).json({ error: `Required fields missing: ${missing.join(', ')}` });
      return;
    }

    // Validate email format
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({ error: 'Please enter a valid email address' });
        return;
      }
    }

    // Normalize phone: strip +91, 91, 0 prefix → must be exactly 10 digits
    if (phone) {
      let cleaned = phone.replace(/[\s\-()]/g, '');
      if (cleaned.startsWith('+91')) cleaned = cleaned.slice(3);
      else if (cleaned.startsWith('91') && cleaned.length > 10) cleaned = cleaned.slice(2);
      else if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
      if (!/^\d{10}$/.test(cleaned)) {
        res.status(400).json({ error: 'Please enter a valid 10-digit phone number' });
        return;
      }
      phone = cleaned; // store normalized 10-digit number
    }

    // Duplicate check — scoped to the form's pipeline (matches per-pipeline uniqueness)
    const dupRows: Array<{ id: string }> = [];
    const pipelineId = form.pipeline_id ?? null;
    if (email) {
      const r = pipelineId
        ? await query(
            `SELECT id FROM leads WHERE LOWER(email)=$1 AND tenant_id=$2 AND pipeline_id=$3 AND is_deleted=FALSE LIMIT 1`,
            [email, form.tenant_id, pipelineId]
          )
        : await query(
            `SELECT id FROM leads WHERE LOWER(email)=$1 AND tenant_id=$2 AND is_deleted=FALSE LIMIT 1`,
            [email, form.tenant_id]
          );
      if (r.rows[0]) dupRows.push(r.rows[0]);
    }
    if (!dupRows.length && phone) {
      const r = pipelineId
        ? await query(
            `SELECT id FROM leads WHERE phone=$1 AND tenant_id=$2 AND pipeline_id=$3 AND is_deleted=FALSE LIMIT 1`,
            [phone, form.tenant_id, pipelineId]
          )
        : await query(
            `SELECT id FROM leads WHERE phone=$1 AND tenant_id=$2 AND is_deleted=FALSE LIMIT 1`,
            [phone, form.tenant_id]
          );
      if (r.rows[0]) dupRows.push(r.rows[0]);
    }

    let leadId: string;

    if (dupRows[0]) {
      // Existing lead — update name/email/phone if missing, then fire re-submission triggers
      leadId = dupRows[0].id;
      await query(
        `UPDATE leads SET
           name  = CASE WHEN name  IS NULL OR name  = ''  THEN $2 ELSE name  END,
           email = CASE WHEN email IS NULL OR email = ''  THEN $3 ELSE email END,
           phone = CASE WHEN phone IS NULL OR phone = ''  THEN $4 ELSE phone END,
           updated_at = NOW()
         WHERE id=$1`,
        [leadId, name || 'Unknown', email, phone]
      ).catch(() => null);

      const fullLead = (await query('SELECT * FROM leads WHERE id=$1', [leadId])).rows[0] ?? { id: leadId };
      const leadWithForm = { ...fullLead, form_id: form.id, form_name: form.name };

      if (Object.keys(customFieldsData).length > 0) {
        await backfillCustomFields(leadId, form.tenant_id, customFieldsData);
      }

      emitToTenant(form.tenant_id, 'lead:updated', fullLead);
      setImmediate(() => triggerWorkflows('opt_in_form', leadWithForm, form.tenant_id, 'system').catch((e) => console.error('[trigger opt_in_form re-sub]', e)));
    } else {
      // New lead
      const leadRes = await query(
        `INSERT INTO leads (tenant_id, name, email, phone, source, custom_form_id, pipeline_id, stage_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [form.tenant_id, name || 'Unknown', email, phone, `form:${form.name}`, form.id, form.pipeline_id ?? null, form.stage_id ?? null]
      );
      const lead = leadRes.rows[0];
      leadId = lead.id;

      if (Object.keys(customFieldsData).length > 0) {
        await backfillCustomFields(leadId, form.tenant_id, customFieldsData);
      }

      emitToTenant(form.tenant_id, 'lead:created', lead);
      sendNewLeadNotification(form.tenant_id, lead, null).catch(() => null);
      const leadWithForm = { ...lead, form_id: form.id, form_name: form.name };
      setImmediate(async () => {
        const { isNew } = await upsertContact(form.tenant_id, lead.name, lead.email, lead.phone, lead.id).catch(() => ({ isNew: false }));
        triggerWorkflows('opt_in_form', leadWithForm, form.tenant_id, 'system').catch((e) => console.error('[trigger opt_in_form new]', e));
        triggerWorkflows('lead_created', leadWithForm, form.tenant_id, 'system').catch((e) => console.error('[trigger lead_created form new]', e));
        if (isNew) triggerWorkflows('contact_created', leadWithForm, form.tenant_id, 'system', { triggerContext: { source: 'Custom Form' } }).catch(() => null);
      });
    }

    // Insert submission record
    await query(
      `INSERT INTO form_submissions (form_id, tenant_id, data) VALUES ($1,$2,$3)`,
      [form.id, form.tenant_id, JSON.stringify(data)]
    );

    // Log to enquiry_log — every submission, even duplicates
    {
      let pName: string | null = null;
      let sName: string | null = null;
      if (pipelineId) {
        const pRes = await query('SELECT name FROM pipelines WHERE id=$1::uuid', [pipelineId]);
        pName = pRes.rows[0]?.name ?? null;
      }
      if (form.stage_id) {
        const sRes = await query('SELECT name FROM pipeline_stages WHERE id=$1::uuid', [form.stage_id]);
        sName = sRes.rows[0]?.name ?? null;
      }
      await query(
        `INSERT INTO enquiry_log (tenant_id, phone, email, lead_id, form_type, form_id, form_name, pipeline_id, pipeline_name, stage_id, stage_name, source, is_duplicate, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [form.tenant_id, phone || null, email || null, leadId, 'custom_form', form.id, form.name,
         pipelineId, pName, form.stage_id ?? null, sName, `form:${form.name}`, !!dupRows[0],
         JSON.stringify(data)]
      ).catch((e: any) => console.error('[enquiry_log form]', e.message));
    }

    const redirectUrl = form.redirect_url;
    const thankYou = form.thank_you_message ?? 'Thank you for your submission!';
    res.json({ success: true, message: thankYou, redirectUrl: redirectUrl || null });
  } catch (err) {
    console.error('[public form submit]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Public Booking Helpers ──────────────────────────────────────────────────

function isValidDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const dt = new Date(d + 'T12:00:00');
  return !isNaN(dt.getTime());
}

function isValidTime(t: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(t)) return false;
  const [h, m] = t.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

// ── Public Booking ─────────────────────────────────────────────────────────────

// GET /api/public/book/:slug — return booking link info
router.get('/book/:slug', bookingLimiter, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, duration_mins, buffer_mins, max_per_day, location, description, availability
       FROM booking_links WHERE slug=$1 AND is_active=TRUE ORDER BY created_at ASC LIMIT 1`,
      [req.params.slug]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Booking link not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/public/book/:slug/slots?date=YYYY-MM-DD — available slots
router.get('/book/:slug/slots', bookingLimiter, async (req: Request, res: Response) => {
  const { date } = req.query as { date: string };
  if (!date) { res.status(400).json({ error: 'date query param required' }); return; }
  if (!isValidDate(date)) { res.status(400).json({ error: 'Invalid date format, expected YYYY-MM-DD' }); return; }

  // FIX A: Reject past dates — no slots for yesterday or earlier
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(date + 'T00:00:00') < today) {
    res.json({ slots: [] }); return;
  }

  try {
    const linkRes = await query(
      `SELECT * FROM booking_links WHERE slug=$1 AND is_active=TRUE`,
      [req.params.slug]
    );
    const link = linkRes.rows[0];
    if (!link) { res.status(404).json({ error: 'Booking link not found' }); return; }

    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    // Use noon local time to avoid midnight DST edge-cases flipping the day
    const dayName = dayNames[new Date(date + 'T12:00:00').getDay()];
    const dayAvail = link.availability?.[dayName];
    if (!dayAvail?.enabled) { res.json({ slots: [] }); return; }

    // Generate all candidate slots
    const slots: string[] = [];
    const [startH, startM] = (dayAvail.start ?? '09:00').split(':').map(Number);
    const [endH,   endM]   = (dayAvail.end   ?? '17:00').split(':').map(Number);
    const durationMins = link.duration_mins ?? 30;
    const stepMins = durationMins + (link.buffer_mins ?? 0);
    let cur = startH * 60 + startM;
    const end = endH * 60 + endM;
    const nowMins = today.getDate() === new Date(date + 'T00:00:00').getDate()
      ? new Date().getHours() * 60 + new Date().getMinutes()
      : -1;

    // FIX C: Only active (non-cancelled, non-no-show, non-deleted) bookings block a slot
    const activeBookingsRes = await query(
      `SELECT start_time FROM calendar_events
       WHERE tenant_id=$1 AND DATE(start_time)=$2
         AND status NOT IN ('cancelled','no-show') AND is_deleted=FALSE`,
      [link.tenant_id, date]
    );
    const bookedTimes = new Set(
      activeBookingsRes.rows.map((r: any) => {
        const d = new Date(r.start_time);
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      })
    );

    while (cur + durationMins <= end) {
      const hh = String(Math.floor(cur / 60)).padStart(2, '0');
      const mm = String(cur % 60).padStart(2, '0');
      const time = `${hh}:${mm}`;
      // FIX A: For today, skip slots that have already passed
      if (cur > nowMins && !bookedTimes.has(time)) slots.push(time);
      cur += stepMins;
    }

    // FIX C: max_per_day — count only scheduled/rescheduled, exclude deleted
    if (link.max_per_day) {
      const dayCountRes = await query(
        `SELECT COUNT(*) AS cnt FROM calendar_events
         WHERE tenant_id=$1 AND DATE(start_time)=$2
           AND status IN ('scheduled','rescheduled') AND is_deleted=FALSE`,
        [link.tenant_id, date]
      );
      const dayCount = parseInt(dayCountRes.rows[0]?.cnt ?? '0', 10);
      const available = Math.max(0, link.max_per_day - dayCount);
      res.json({ slots: slots.slice(0, available) });
    } else {
      res.json({ slots });
    }
  } catch (err) {
    console.error('[public book slots]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/public/book/:slug — submit a booking
router.post('/book/:slug', bookingLimiter, async (req: Request, res: Response) => {
  const { name, date, time, notes } = req.body;
  // Normalize email at parse time — FIX #10
  const email: string = ((req.body.email ?? '') as string).toLowerCase().trim();
  const phone: string = ((req.body.phone ?? '') as string).trim();

  if (!name || !date || !time) {
    res.status(400).json({ error: 'name, date, time required' }); return;
  }
  // FIX #3: Validate input formats before hitting the DB
  if (!isValidDate(date)) {
    res.status(400).json({ error: 'Invalid date format, expected YYYY-MM-DD' }); return;
  }
  if (!isValidTime(time)) {
    res.status(400).json({ error: 'Invalid time format, expected HH:MM' }); return;
  }

  const startTime = new Date(`${date}T${time}:00`);
  if (isNaN(startTime.getTime())) {
    res.status(400).json({ error: 'Invalid date/time combination' }); return;
  }

  // FIX A: Reject past bookings
  if (startTime.getTime() <= Date.now()) {
    res.status(400).json({ error: 'Cannot book a slot in the past' }); return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the booking_link row — serializes all concurrent bookings for this link (FIX #1/#2)
    const linkRes = await client.query(
      `SELECT * FROM booking_links WHERE slug=$1 AND is_active=TRUE FOR UPDATE`,
      [req.params.slug]
    );
    const link = linkRes.rows[0];
    if (!link) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Booking link not found' }); return;
    }

    const durationMins = link.duration_mins ?? 30;
    const endTime = new Date(startTime.getTime() + durationMins * 60000);

    // FIX B: Enforce availability window — same rules the slots endpoint uses
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const dayName = dayNames[new Date(date + 'T12:00:00').getDay()];
    const dayAvail = link.availability?.[dayName];
    if (!dayAvail?.enabled) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: `No availability on ${dayName}` }); return;
    }
    const [startH, startM] = (dayAvail.start ?? '09:00').split(':').map(Number);
    const [endH,   endM]   = (dayAvail.end   ?? '17:00').split(':').map(Number);
    const [reqH,   reqM]   = time.split(':').map(Number);
    const reqMins   = reqH * 60 + reqM;
    const winStart  = startH * 60 + startM;
    const winEnd    = endH * 60 + endM;
    if (reqMins < winStart || reqMins + durationMins > winEnd) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: `Requested time is outside available hours (${dayAvail.start}–${dayAvail.end})` }); return;
    }

    // FIX #1/#2: Slot conflict check inside the transaction
    // FIX C: Exclude soft-deleted events
    const conflict = await client.query(
      `SELECT id FROM calendar_events
       WHERE tenant_id=$1 AND status NOT IN ('cancelled','no-show') AND is_deleted=FALSE
         AND start_time < $2 AND end_time > $3`,
      [link.tenant_id, endTime.toISOString(), startTime.toISOString()]
    );
    if (conflict.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'This slot is no longer available' }); return;
    }

    // FIX #14 + FIX C: max_per_day — only count scheduled/rescheduled, exclude deleted
    if (link.max_per_day) {
      const dayCountRes = await client.query(
        `SELECT COUNT(*) AS cnt FROM calendar_events
         WHERE tenant_id=$1 AND DATE(start_time)=$2
           AND status IN ('scheduled','rescheduled') AND is_deleted=FALSE`,
        [link.tenant_id, date]
      );
      const dayCount = parseInt(dayCountRes.rows[0]?.cnt ?? '0', 10);
      if (dayCount >= link.max_per_day) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'No more bookings available for this day' }); return;
      }
    }

    // FIX #9: Lead upsert inside transaction — atomic dedup with email normalization
    let leadId: string | null = null;
    let isNewLead = false;
    if (email || phone) {
      const dupCheck = await client.query(
        `SELECT id FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE
         AND (($2::text <> '' AND LOWER(email)=$2) OR ($3::text <> '' AND phone=$3))
         LIMIT 1`,
        [link.tenant_id, email, phone]
      );
      if (dupCheck.rows[0]) {
        leadId = dupCheck.rows[0].id;
      } else {
        try {
          const leadRes = await client.query(
            `INSERT INTO leads (tenant_id, name, email, phone, source) VALUES ($1,$2,$3,$4,'Booking') RETURNING id`,
            [link.tenant_id, name, email, phone]
          );
          leadId = leadRes.rows[0].id;
          isNewLead = true;
          sendNewLeadNotification(link.tenant_id, leadRes.rows[0], null).catch(() => null);
        } catch {
          // Race: another request inserted the same lead between dedup check and insert
          const retryRes = await client.query(
            `SELECT id FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE
             AND (($2::text <> '' AND LOWER(email)=$2) OR ($3::text <> '' AND phone=$3))
             LIMIT 1`,
            [link.tenant_id, email, phone]
          );
          leadId = retryRes.rows[0]?.id ?? null;
        }
      }
    }

    // Insert calendar event with explicit 'scheduled' status
    const eventRes = await client.query(
      `INSERT INTO calendar_events (tenant_id, title, description, start_time, end_time, type, lead_id, created_by, status)
       VALUES ($1,$2,$3,$4,$5,'booking',$6,'system','scheduled') RETURNING id`,
      [link.tenant_id, `Booking: ${name}`, notes ?? '', startTime.toISOString(), endTime.toISOString(), leadId]
    );
    const eventId = eventRes.rows[0].id;

    await client.query('COMMIT');

    // Async side effects — fire after commit so they never roll back with us
    if (leadId) {
      const capturedLeadId = leadId;
      const capturedName = name;
      const tenantId = link.tenant_id;
      const newLead = isNewLead;
      setImmediate(async () => {
        try {
          await upsertContact(tenantId, capturedName, email, phone, capturedLeadId).catch(() => null);
          if (newLead) {
            triggerWorkflows('lead_created', { id: capturedLeadId, name: capturedName }, tenantId, 'system').catch(() => null);
          }
          triggerWorkflows('calendar_form_submitted', { id: capturedLeadId, name: capturedName }, tenantId, 'system',
            { triggerContext: { calendarId: link.id, apptType: link.name ?? 'Booking' } }).catch(() => null);
          triggerWorkflows('appointment_booked', { id: capturedLeadId, name: capturedName }, tenantId, 'system',
            { triggerContext: { calendarId: link.id, apptType: link.name ?? 'Booking' } }).catch(() => null);
        } catch {}
      });
    }

    res.status(201).json({ success: true, event_id: eventId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => null);
    console.error('[public book submit]', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── External trigger endpoints ─────────────────────────────────────────────────
// These endpoints are called by external systems (payment gateways, LMS, custom integrations)
// to trigger CRM workflows for matched leads.

// POST /api/public/webhook-inbound/:tenantId
// Universal inbound webhook — finds or creates a lead and fires webhook_inbound workflows
router.post('/webhook-inbound/:tenantId', bookingLimiter, async (req: Request, res: Response) => {
  try {
    const tenantRes = await query('SELECT id FROM tenants WHERE id=$1::uuid LIMIT 1', [req.params.tenantId]);
    if (!tenantRes.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }

    const body = req.body ?? {};
    const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const name  = typeof body.name  === 'string' ? body.name.trim()  : 'Webhook Lead';

    res.json({ received: true });

    if (!email && !phone) return;

    const tenantId = req.params.tenantId;
    setImmediate(async () => {
      try {
        let leadId: string;
        let leadName: string = name;

        const existing = await query(
          `SELECT id, name FROM leads WHERE tenant_id=$1::uuid AND is_deleted=FALSE
           AND (($2::text<>'' AND LOWER(email)=$2) OR ($3::text<>'' AND phone=$3)) LIMIT 1`,
          [tenantId, email, phone]
        );
        if (existing.rows[0]) {
          leadId = existing.rows[0].id;
          leadName = existing.rows[0].name;
        } else {
          const ins = await query(
            `INSERT INTO leads (tenant_id, name, email, phone, source) VALUES ($1::uuid,$2,$3,$4,'Webhook') RETURNING *`,
            [tenantId, name, email || null, phone || null]
          );
          leadId = ins.rows[0].id;
          leadName = ins.rows[0].name;
          emitToTenant(tenantId, 'lead:created', ins.rows[0]);
          sendNewLeadNotification(tenantId, ins.rows[0], null).catch(() => null);
        }

        await triggerWorkflows('webhook_inbound', { id: leadId, name: leadName }, tenantId, 'webhook').catch(() => null);
      } catch (err) {
        console.error('[webhook_inbound async]', err);
      }
    });
  } catch (err) {
    console.error('[webhook_inbound]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/public/trigger/payment/:tenantId
// Called by payment gateways (Razorpay, Stripe, etc.) to fire payment_received workflows
router.post('/trigger/payment/:tenantId', bookingLimiter, async (req: Request, res: Response) => {
  try {
    const tenantRes = await query('SELECT id FROM tenants WHERE id=$1::uuid LIMIT 1', [req.params.tenantId]);
    if (!tenantRes.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }

    const body = req.body ?? {};
    const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';

    res.json({ received: true });

    if (!email && !phone) return;

    const tenantId = req.params.tenantId;
    setImmediate(async () => {
      try {
        const existing = await query(
          `SELECT id, name FROM leads WHERE tenant_id=$1::uuid AND is_deleted=FALSE
           AND (($2::text<>'' AND LOWER(email)=$2) OR ($3::text<>'' AND phone=$3)) LIMIT 1`,
          [tenantId, email, phone]
        );
        if (!existing.rows[0]) return;
        await triggerWorkflows('payment_received', existing.rows[0], tenantId, 'webhook').catch(() => null);
      } catch (err) {
        console.error('[payment_received async]', err);
      }
    });
  } catch (err) {
    console.error('[payment_received endpoint]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/public/trigger/course/:tenantId
// Called by LMS systems to fire course_enrolled workflows
router.post('/trigger/course/:tenantId', bookingLimiter, async (req: Request, res: Response) => {
  try {
    const tenantRes = await query('SELECT id FROM tenants WHERE id=$1::uuid LIMIT 1', [req.params.tenantId]);
    if (!tenantRes.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }

    const body = req.body ?? {};
    const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';

    res.json({ received: true });

    if (!email && !phone) return;

    const tenantId = req.params.tenantId;
    setImmediate(async () => {
      try {
        const existing = await query(
          `SELECT id, name FROM leads WHERE tenant_id=$1::uuid AND is_deleted=FALSE
           AND (($2::text<>'' AND LOWER(email)=$2) OR ($3::text<>'' AND phone=$3)) LIMIT 1`,
          [tenantId, email, phone]
        );
        if (!existing.rows[0]) return;
        await triggerWorkflows('course_enrolled', existing.rows[0], tenantId, 'webhook').catch(() => null);
      } catch (err) {
        console.error('[course_enrolled async]', err);
      }
    });
  } catch (err) {
    console.error('[course_enrolled endpoint]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Public media endpoint for WABA media sends ───────────────────────────────
// Meta needs to download the media from a public URL when we send media messages.
const WA_MEDIA_DIR = process.env.WA_MEDIA_DIR || path.join(process.cwd(), 'wa_media');

router.get('/waba-media/:tenantId/:filename', (req: Request, res: Response) => {
  const { tenantId, filename } = req.params;
  // Sanitize to prevent path traversal
  const safeTenant = path.basename(tenantId);
  const safeFile = path.basename(filename);
  const filePath = path.join(WA_MEDIA_DIR, safeTenant, safeFile);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.sendFile(filePath);
});

// ── Public landing pages ──────────────────────────────────────────────────────

const pageLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: process.env.NODE_ENV === 'production' ? 60 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
});

// GET /api/public/page/:slug — view a published landing page
router.get('/page/:slug', pageLimiter, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT lp.id, lp.title, lp.slug, lp.content, lp.tenant_id,
              t.name AS company_name
       FROM landing_pages lp
       JOIN tenants t ON t.id = lp.tenant_id
       WHERE lp.slug=$1 AND lp.status='published' AND lp.is_deleted=FALSE`,
      [req.params.slug]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Page not found' }); return; }
    // Increment view counter (fire-and-forget)
    query('UPDATE landing_pages SET views = views + 1 WHERE id=$1', [result.rows[0].id]).catch(() => {});
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[public page]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/public/page/:slug/submit — submit a lead form on a landing page
const pageSubmitLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: process.env.NODE_ENV === 'production' ? 20 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

router.post('/page/:slug/submit', pageSubmitLimiter, async (req: Request, res: Response) => {
  try {
    const pageResult = await query(
      `SELECT id, tenant_id, title FROM landing_pages
       WHERE slug=$1 AND status='published' AND is_deleted=FALSE`,
      [req.params.slug]
    );
    if (!pageResult.rows[0]) { res.status(404).json({ error: 'Page not found' }); return; }
    const page = pageResult.rows[0];

    const { name, email, phone, message, company } = req.body;
    if (!name?.trim() && !email?.trim() && !phone?.trim()) {
      res.status(400).json({ error: 'At least one contact field is required' }); return;
    }

    // Find default pipeline + first stage for this tenant
    const pipeResult = await query(
      `SELECT p.id AS pipeline_id, ps.id AS stage_id
       FROM pipelines p
       JOIN pipeline_stages ps ON ps.pipeline_id = p.id
       WHERE p.tenant_id=$1 AND p.is_default=TRUE
       ORDER BY ps.stage_order ASC LIMIT 1`,
      [page.tenant_id]
    );
    // Fallback: any pipeline
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    if (pipeResult.rows[0]) {
      pipelineId = pipeResult.rows[0].pipeline_id;
      stageId = pipeResult.rows[0].stage_id;
    } else {
      const anyPipe = await query(
        `SELECT p.id AS pipeline_id, ps.id AS stage_id
         FROM pipelines p
         JOIN pipeline_stages ps ON ps.pipeline_id = p.id
         WHERE p.tenant_id=$1
         ORDER BY ps.stage_order ASC LIMIT 1`,
        [page.tenant_id]
      );
      if (anyPipe.rows[0]) {
        pipelineId = anyPipe.rows[0].pipeline_id;
        stageId = anyPipe.rows[0].stage_id;
      }
    }

    if (!pipelineId || !stageId) {
      res.status(500).json({ error: 'No pipeline configured' }); return;
    }

    // Dedup by phone or email within the pipeline
    const normEmail = email?.trim()?.toLowerCase() || '';
    const normPhone = phone?.trim() || '';
    let isDuplicate = false;
    let existingLeadId: string | null = null;

    if (normEmail) {
      const r = await query(
        `SELECT id FROM leads WHERE tenant_id=$1 AND pipeline_id=$2 AND LOWER(email)=$3 AND is_deleted=FALSE LIMIT 1`,
        [page.tenant_id, pipelineId, normEmail]
      );
      if (r.rows[0]) { isDuplicate = true; existingLeadId = r.rows[0].id; }
    }
    if (!isDuplicate && normPhone) {
      const r = await query(
        `SELECT id FROM leads WHERE tenant_id=$1 AND pipeline_id=$2 AND phone=$3 AND is_deleted=FALSE LIMIT 1`,
        [page.tenant_id, pipelineId, normPhone]
      );
      if (r.rows[0]) { isDuplicate = true; existingLeadId = r.rows[0].id; }
    }

    const fullName = (name?.trim() || 'Unknown');
    let leadId: string;

    if (isDuplicate && existingLeadId) {
      leadId = existingLeadId;
      // Update missing fields on existing lead
      await query(
        `UPDATE leads SET
           name  = CASE WHEN name  IS NULL OR name  = '' THEN $2 ELSE name  END,
           email = CASE WHEN email IS NULL OR email = '' THEN $3 ELSE email END,
           phone = CASE WHEN phone IS NULL OR phone = '' THEN $4 ELSE phone END,
           updated_at = NOW()
         WHERE id=$1`,
        [leadId, fullName, normEmail || null, normPhone || null]
      ).catch(() => null);
      query('UPDATE landing_pages SET leads = leads + 1 WHERE id=$1', [page.id]).catch(() => {});
    } else {
      const leadResult = await query(
        `INSERT INTO leads (tenant_id, name, email, phone, source, pipeline_id, stage_id, custom_fields)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          page.tenant_id, fullName,
          normEmail || null, normPhone || null,
          `Landing Page: ${page.title}`,
          pipelineId, stageId,
          JSON.stringify({ company: company?.trim() || '', message: message?.trim() || '', landing_page_slug: req.params.slug }),
        ]
      );
      const lead = leadResult.rows[0];
      leadId = lead.id;

      // Increment leads counter
      query('UPDATE landing_pages SET leads = leads + 1 WHERE id=$1', [page.id]).catch(() => {});

      // Backfill custom fields
      try { await backfillCustomFields(lead.id, page.tenant_id, {}); } catch {}

      // Emit socket event
      try {
        const withJoin = await query(
          'SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id=$1',
          [lead.id]
        );
        emitToTenant(page.tenant_id, 'lead:created', withJoin.rows[0] ?? lead);
      } catch {}

      // Trigger workflows
      try { await triggerWorkflows('lead_created', lead, page.tenant_id, lead.id); } catch {}

      // Upsert contact
      try { await upsertContact(page.tenant_id, fullName, normEmail || null, normPhone || null, lead.id); } catch {}

      // Notify
      try {
        await sendNewLeadNotification(page.tenant_id, {
          id: lead.id, name: fullName, source: lead.source,
          pipeline_id: pipelineId!, stage_id: stageId!,
        }, null);
      } catch {}
    }

    // Log to enquiry_log
    {
      let pName: string | null = null;
      let sName: string | null = null;
      if (pipelineId) {
        const pRes = await query('SELECT name FROM pipelines WHERE id=$1::uuid', [pipelineId]);
        pName = pRes.rows[0]?.name ?? null;
      }
      if (stageId) {
        const sRes = await query('SELECT name FROM pipeline_stages WHERE id=$1::uuid', [stageId]);
        sName = sRes.rows[0]?.name ?? null;
      }
      await query(
        `INSERT INTO enquiry_log (tenant_id, phone, email, lead_id, form_type, form_id, form_name, pipeline_id, pipeline_name, stage_id, stage_name, source, is_duplicate, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [page.tenant_id, normPhone || null, normEmail || null, leadId, 'landing_page', page.id, page.title,
         pipelineId, pName, stageId, sName, `Landing Page: ${page.title}`, isDuplicate,
         JSON.stringify({ name: name?.trim(), email: normEmail, phone: normPhone, company: company?.trim(), message: message?.trim() })]
      ).catch((e: any) => console.error('[enquiry_log landing]', e.message));
    }

    res.json({ success: true, duplicate: isDuplicate });
  } catch (err: any) {
    console.error('[page submit]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/public/razorpay/:tenantId - Razorpay webhook receiver
router.post('/razorpay/:tenantId', bookingLimiter, async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId;

  try {
    // 1. Verify tenant exists
    const tenantRes = await query('SELECT id FROM tenants WHERE id=$1::uuid LIMIT 1', [tenantId]);
    if (!tenantRes.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }

    // 2. Get webhook secret from integration_configs
    const configRes = await query(
      `SELECT config_json FROM integration_configs WHERE tenant_id=$1::uuid AND integration_id='razorpay' AND is_active=TRUE`,
      [tenantId]
    );
    const secret = configRes.rows[0]?.config_json?.webhook_secret;
    if (!secret) { res.status(400).json({ error: 'Razorpay not configured' }); return; }

    // 3. Verify signature
    const signature = req.headers['x-razorpay-signature'] as string;
    if (!signature) { res.status(400).json({ error: 'Missing signature' }); return; }

    const body = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (signature !== expected) { res.status(400).json({ error: 'Invalid signature' }); return; }

    // 4. Respond immediately (Razorpay retries on non-2xx)
    res.json({ status: 'ok' });

    // 5. Process async
    const event = req.body?.event;
    const entity = req.body?.payload?.payment?.entity;
    if (!entity) return;

    setImmediate(async () => {
      try {
        const rpId = entity.id;
        const amount = entity.amount ?? 0; // in paise
        const currency = entity.currency ?? 'INR';
        const method = entity.method ?? null;
        const email = (entity.email ?? '').toLowerCase().trim();
        const phone = (entity.contact ?? '').replace(/[^0-9]/g, '');
        const customerName = entity.notes?.customer_name ?? entity.notes?.name ?? null;
        const orderId = entity.order_id ?? null;
        const description = entity.description ?? null;
        const notes = entity.notes ?? {};

        let status = 'captured';
        if (event === 'payment.failed') status = 'failed';
        if (event === 'refund.created') status = 'refunded';

        const paidAt = entity.created_at ? new Date(entity.created_at * 1000) : new Date();

        // Lead matching - by email or last 10 digits of phone
        let leadId: string | null = null;
        const phoneLast10 = phone.slice(-10);
        if (email || phoneLast10.length === 10) {
          const leadRes = await query(
            `SELECT id FROM leads WHERE tenant_id=$1::uuid AND is_deleted=FALSE
             AND (($2::text<>'' AND LOWER(email)=$2) OR ($3::text<>'' AND phone LIKE '%' || $3))
             LIMIT 1`,
            [tenantId, email, phoneLast10]
          );
          leadId = leadRes.rows[0]?.id ?? null;
        }

        // Auto-create lead if no match found and we have contact info
        if (!leadId && status === 'captured' && (email || phone)) {
          try {
            // Find default pipeline + first stage
            const pipeResult = await query(
              `SELECT p.id AS pipeline_id, ps.id AS stage_id
               FROM pipelines p
               JOIN pipeline_stages ps ON ps.pipeline_id = p.id
               WHERE p.tenant_id=$1::uuid AND p.is_default=TRUE
               ORDER BY ps.stage_order ASC LIMIT 1`,
              [tenantId]
            );
            let pipelineId: string | null = pipeResult.rows[0]?.pipeline_id ?? null;
            let stageId: string | null = pipeResult.rows[0]?.stage_id ?? null;
            if (!pipelineId) {
              const anyPipe = await query(
                `SELECT p.id AS pipeline_id, ps.id AS stage_id
                 FROM pipelines p
                 JOIN pipeline_stages ps ON ps.pipeline_id = p.id
                 WHERE p.tenant_id=$1::uuid
                 ORDER BY p.created_at ASC, ps.stage_order ASC LIMIT 1`,
                [tenantId]
              );
              pipelineId = anyPipe.rows[0]?.pipeline_id ?? null;
              stageId = anyPipe.rows[0]?.stage_id ?? null;
            }

            const leadName = customerName || email || phone;
            const newLead = await query(
              `INSERT INTO leads (tenant_id, name, email, phone, source, pipeline_id, stage_id)
               VALUES ($1::uuid, $2, $3, $4, 'Razorpay', $5::uuid, $6::uuid)
               RETURNING id`,
              [tenantId, leadName, email || null, phone || null, pipelineId, stageId]
            );
            leadId = newLead.rows[0]?.id ?? null;
            console.log(`[razorpay] Auto-created lead ${leadId} for tenant ${tenantId}`);
          } catch (autoErr) {
            console.error('[razorpay] Auto-create lead failed:', autoErr);
          }
        }

        // Upsert payment
        await query(
          `INSERT INTO payments (tenant_id, lead_id, razorpay_payment_id, razorpay_order_id,
            amount, currency, status, method, email, phone, customer_name, description, notes, raw_payload, paid_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15)
           ON CONFLICT (tenant_id, razorpay_payment_id) DO UPDATE SET
             status = EXCLUDED.status, raw_payload = EXCLUDED.raw_payload, lead_id = COALESCE(payments.lead_id, EXCLUDED.lead_id)`,
          [tenantId, leadId, rpId, orderId, amount, currency, status, method, email, phone, customerName, description, JSON.stringify(notes), JSON.stringify(req.body), paidAt]
        );

        // Add timeline activity if linked to a lead and payment captured
        if (leadId && status === 'captured') {
          const amountRs = (amount / 100).toLocaleString('en-IN');
          await query(
            `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
             VALUES ($1::uuid, $2::uuid, 'payment', $3, $4, NULL)`,
            [leadId, tenantId, `Payment received - Rs ${amountRs} via ${method ?? 'unknown'}`, description ?? null]
          );

          // Fire payment_received workflow trigger
          const leadData = await query('SELECT * FROM leads WHERE id=$1::uuid', [leadId]);
          if (leadData.rows[0]) {
            triggerWorkflows('payment_received', leadData.rows[0], tenantId, 'webhook').catch(() => null);
          }
        }
      } catch (err) {
        console.error('[razorpay webhook]', err);
      }
    });
  } catch (err) {
    console.error('[razorpay webhook outer]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
