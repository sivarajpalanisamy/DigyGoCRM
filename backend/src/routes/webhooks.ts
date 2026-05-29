import { Router, Request, Response } from 'express';
import { query } from '../db';
import { triggerWorkflows } from './workflows';
import { decrypt } from '../utils/crypto';
import { parseMetaFieldData } from '../utils/meta';
import { upsertContact } from '../utils/contacts';
import { emitToTenant } from '../socket';
import { sendNewLeadNotification, sendCallLoggedNotification } from '../utils/notifications';
import crypto from 'crypto';
import https from 'https';

const router = Router();

function graphGet(path: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `https://graph.facebook.com/v21.0${path}?access_token=${encodeURIComponent(token)}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    }).on('error', reject);
  });
}

// ── Meta Verification ─────────────────────────────────────────────────────────

router.get('/meta', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// ── Meta Webhook (legacy route — /api/webhooks/meta) ─────────────────────────
// Raw body middleware is applied in index.ts for this path.
// Signature is verified using the raw buffer before JSON parsing.

router.post('/meta', (req: Request, res: Response) => {
  // Leak 7 fix: reject if secret not configured
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) { res.status(401).send('Webhook secret not configured'); return; }
  const sig = req.headers['x-hub-signature-256'] as string | undefined;
  if (!sig) { res.status(401).send('Missing x-hub-signature-256 header'); return; }
  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(req.body as Buffer)
    .digest('hex');
  if (sig !== expected) { res.status(401).send('Invalid signature'); return; }

  let body: any;
  try { body = JSON.parse((req.body as Buffer).toString()); } catch { res.status(400).send('Bad JSON'); return; }

  res.status(200).send('EVENT_RECEIVED');

  setImmediate(() => processMetaWebhook(body).catch(() => null));
});

async function processMetaWebhook(payload: any) {
  try {
    const entries: any[] = payload.entry ?? [];
    for (const entry of entries) {
      const changes: any[] = entry.changes ?? [];
      for (const change of changes) {
        if (change.field !== 'leadgen') continue;
        const { leadgen_id: leadgenId, page_id: pageId, form_id: formId } = change.value ?? {};
        if (!leadgenId || !pageId) continue;

        // 1. True idempotency — skip if already processed
        const idem = await query(
          `SELECT id FROM leads WHERE source='meta_form' AND source_ref=$1 LIMIT 1`,
          [leadgenId]
        );
        if (idem.rows[0]) continue;

        // Find tenant via meta_forms joined with meta_integrations
        const tenantRes = await query(
          `SELECT mf.id AS mf_id, mf.tenant_id, mf.pipeline_id, mf.stage_id,
                  mf.field_mapping, mf.form_id, mf.form_name, mi.access_token
           FROM meta_forms mf
           JOIN meta_integrations mi ON mi.tenant_id = mf.tenant_id
           WHERE mf.form_id=$1 AND mf.page_id=$2 AND mf.is_active=TRUE
           LIMIT 1`,
          [formId, pageId]
        );
        const row = tenantRes.rows[0];
        if (!row) continue;

        const token = decrypt(row.access_token);

        // 2. Fetch field_data from Meta
        const leadData = await graphGet(`/${leadgenId}?fields=field_data`, token);
        // Leak 1 fix: expired token returns an error — skip rather than insert a blank lead
        if (leadData.error) {
          console.error(`[Meta webhook legacy] Graph API error for leadgen ${leadgenId}:`, leadData.error.message ?? leadData.error);
          continue;
        }
        const fieldData: Array<{ name: string; values: string[] }> = leadData.field_data ?? [];

        // 3. Guard: skip lead if no field mapping configured yet
        const mapping: Array<{ fb_field: string; crm_field: string }> = row.field_mapping ?? [];
        if (mapping.length === 0) {
          console.warn(`[Meta webhook legacy] leadgen ${leadgenId} skipped — form ${formId} has no field mapping. Configure mapping to start importing leads.`);
          continue;
        }

        // Parse + normalize using shared utility
        const { name, email, phone, customValues } = parseMetaFieldData(fieldData, mapping);

        // 4. Email/phone dedup
        const existing = (email || phone) ? await query(
          `SELECT id FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE
           AND (($2::text<>'' AND LOWER(email)=$2) OR ($3::text<>'' AND phone=$3)) LIMIT 1`,
          [row.tenant_id, email, phone]
        ) : { rows: [] };

        let leadId: string | null = null;
        let isNew = false;

        if (existing.rows[0]) {
          leadId = existing.rows[0].id;
          await query(
            `UPDATE leads SET
               name  = CASE WHEN (name=''  OR name  IS NULL) THEN $2 ELSE name  END,
               email = CASE WHEN (email='' OR email IS NULL) AND $3<>'' THEN $3 ELSE email END,
               phone = CASE WHEN (phone='' OR phone IS NULL) AND $4<>'' THEN $4 ELSE phone END,
               updated_at=NOW()
             WHERE id=$1`,
            [leadId, name, email, phone]
          );
          const updatedLead = (await query('SELECT * FROM leads WHERE id=$1', [leadId])).rows[0];
          if (updatedLead) emitToTenant(row.tenant_id, 'lead:updated', updatedLead);
        } else {
          isNew = true;
          const ins = await query(
            `INSERT INTO leads (tenant_id, name, email, phone, source, source_ref, pipeline_id, stage_id)
             VALUES ($1,$2,$3,$4,'meta_form',$5,$6,$7) RETURNING *`,
            [row.tenant_id, name, email, phone, leadgenId, row.pipeline_id ?? null, row.stage_id ?? null]
          );
          leadId = ins.rows[0]?.id;
          if (ins.rows[0]) {
            emitToTenant(row.tenant_id, 'lead:created', ins.rows[0]);
            sendNewLeadNotification(row.tenant_id, ins.rows[0], null).catch(() => null);
          }
        }

        // 5. Store custom field values
        if (leadId && Object.keys(customValues).length > 0) {
          for (const [slug, value] of Object.entries(customValues)) {
            const cfRes = await query(
              'SELECT id FROM custom_fields WHERE tenant_id=$1 AND slug=$2 LIMIT 1',
              [row.tenant_id, slug]
            );
            if (cfRes.rows[0]) {
              await query(
                `INSERT INTO lead_field_values (lead_id, tenant_id, field_id, value)
                 VALUES ($1,$2,$3,$4) ON CONFLICT (lead_id, field_id) DO UPDATE SET value=$4`,
                [leadId, row.tenant_id, cfRes.rows[0].id, value]
              );
            }
          }
        }

        // 6. Update form stats
        if (isNew) {
          await query(
            `UPDATE meta_forms SET leads_count=leads_count+1, last_sync_at=NOW() WHERE id=$1`,
            [row.mf_id]
          );
        } else {
          await query(`UPDATE meta_forms SET last_sync_at=NOW() WHERE id=$1`, [row.mf_id]);
        }

        // 7. Auto-create contact record
        if (leadId) {
          await upsertContact(row.tenant_id, name, email, phone, leadId).catch(() => null);
        }

        // 8. Fire automation — meta_form trigger for all, lead_created only for new leads
        if (leadId) {
          const leadCtx = { id: leadId, name, email: email || undefined, phone: phone || undefined,
                            source: 'meta_form', form_id: row.form_id, form_name: row.form_name };
          await triggerWorkflows('meta_form', leadCtx, row.tenant_id, '').catch(() => null);
          if (isNew) {
            await triggerWorkflows('lead_created', leadCtx, row.tenant_id, '').catch(() => null);
          }
        }
      }
    }
  } catch (err) {
    console.error('Meta webhook processing error:', err);
  }
}

// ── WhatsApp Verification ─────────────────────────────────────────────────────

router.get('/whatsapp', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// ── WhatsApp Inbound ──────────────────────────────────────────────────────────

router.post('/whatsapp', (req: Request, res: Response) => {
  res.status(200).send('EVENT_RECEIVED');

  const sig       = req.headers['x-hub-signature-256'] as string | undefined;
  const appSecret = process.env.META_APP_SECRET;
  if (appSecret && sig) {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(req.body as Buffer)
      .digest('hex');
    if (sig !== expected) return;
  }

  let body: any;
  try { body = JSON.parse((req.body as Buffer).toString()); } catch { return; }

  setImmediate(() => processWhatsAppMessage(body).catch(() => null));
});

async function processWhatsAppMessage(payload: any) {
  try {
    const entries: any[] = payload.entry ?? [];
    for (const entry of entries) {
      const changes: any[] = entry.changes ?? [];
      for (const change of changes) {
        const value = change.value ?? {};
        const messages: any[] = value.messages ?? [];
        if (!messages.length) continue;

        const phoneNumberId: string = value.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        const wabaRes = await query(
          'SELECT tenant_id FROM waba_integrations WHERE phone_number_id=$1 AND is_active=TRUE LIMIT 1',
          [phoneNumberId]
        );
        const waba = wabaRes.rows[0];
        if (!waba) continue;
        const tenantId: string = waba.tenant_id;

        for (const msg of messages) {
          const waPhone: string = msg.from;
          const wamid: string   = msg.id;
          const msgType: string = msg.type ?? 'text';
          const content: string =
            msg.text?.body ?? msg.image?.caption ?? msg.document?.filename ?? `[${msgType}]`;

          // Dedup by wamid
          const dupMsg = await query('SELECT id FROM messages WHERE wamid=$1 LIMIT 1', [wamid]);
          if (dupMsg.rows[0]) continue;

          // Find or create lead
          let leadId: string;
          let leadName: string = waPhone;
          const leadRes = await query(
            `SELECT id, name FROM leads WHERE phone=$1 AND tenant_id=$2 AND is_deleted=FALSE LIMIT 1`,
            [waPhone, tenantId]
          );
          if (leadRes.rows[0]) {
            leadId = leadRes.rows[0].id;
            leadName = leadRes.rows[0].name;
          } else {
            const newLead = await query(
              `INSERT INTO leads (tenant_id, name, phone, source) VALUES ($1,$2,$3,'whatsapp') RETURNING *`,
              [tenantId, waPhone, waPhone]
            );
            leadId = newLead.rows[0].id;
            leadName = newLead.rows[0].name;
            emitToTenant(tenantId, 'lead:created', newLead.rows[0]);
            sendNewLeadNotification(tenantId, newLead.rows[0], null).catch(() => null);
            setImmediate(() => {
              upsertContact(tenantId, waPhone, undefined, waPhone, leadId).catch(() => null);
              triggerWorkflows('lead_created', newLead.rows[0], tenantId, 'webhook').catch(() => null);
            });
          }

          // Find or create open conversation
          let convId: string;
          const convRes = await query(
            `SELECT id FROM conversations WHERE lead_id=$1 AND channel='whatsapp' AND status<>'resolved' LIMIT 1`,
            [leadId]
          );
          if (convRes.rows[0]) {
            convId = convRes.rows[0].id;
          } else {
            const newConv = await query(
              `INSERT INTO conversations (tenant_id, lead_id, channel, status, unread_count, last_message, last_message_at)
               VALUES ($1,$2,'whatsapp','open',1,$3,NOW()) RETURNING id`,
              [tenantId, leadId, content]
            );
            convId = newConv.rows[0].id;
          }

          const msgRes = await query(
            `INSERT INTO messages (conversation_id, tenant_id, lead_id, sender, body, is_note, wamid, status, sent_by, created_at)
             VALUES ($1,$2,$3,'customer',$4,FALSE,$5,'delivered','customer',NOW()) RETURNING *`,
            [convId, tenantId, leadId, content, wamid]
          );

          await query(
            `UPDATE conversations SET unread_count=unread_count+1, last_message=$1, last_message_at=NOW() WHERE id=$2`,
            [content, convId]
          );

          if (msgRes.rows[0]) {
            emitToTenant(tenantId, 'message:new', {
              ...msgRes.rows[0], lead_name: leadName, lead_phone: waPhone, channel: 'whatsapp',
            });
            emitToTenant(tenantId, 'conversation:updated', {
              id: convId, lead_id: leadId, lead_name: leadName, lead_phone: waPhone,
              channel: 'whatsapp', status: 'open',
              last_message: content, last_message_at: new Date().toISOString(),
            });
          }

          const lead = { id: leadId, tenant_id: tenantId, phone: waPhone, name: leadName };
          setImmediate(() =>
            triggerWorkflows('inbox_message', lead, tenantId, 'webhook',
              { triggerContext: { channel: 'whatsapp', messageBody: content } }
            ).catch(() => null)
          );
        }
      }
    }
  } catch (err) {
    console.error('WhatsApp webhook processing error:', err);
  }
}

// ── Superfone Webhook ─────────────────────────────────────────────────────────
// POST /api/webhooks/superfone/:tenantId
// No auth required — Superfone POSTs directly, tenant identified by URL param.

router.post('/superfone/:tenantId', async (req: Request, res: Response) => {
  const { tenantId } = req.params;
  const payload = req.body as Record<string, any>;

  // Respond immediately so Superfone doesn't retry
  res.status(200).json({ received: true });

  try {
    // Verify this tenant has Superfone connected and the number matches
    const settingsResult = await query(
      `SELECT superfone_number FROM superfone_settings
       WHERE tenant_id=$1::uuid AND is_connected=TRUE`,
      [tenantId]
    );
    if (!settingsResult.rows[0]) return;

    const {
      cdr_id, cdr_phone, cdr_call_type, cdr_disposition,
      cdr_duration, cdr_start, cdr_end, superfone_number,
      staff_first_name, staff_last_name, staff_phone,
      ivr_inputs, recording_url,
    } = payload;

    if (!cdr_id) return;

    // Build staff name from payload
    const staffName = [staff_first_name, staff_last_name].filter(Boolean).join(' ') || null;

    // Match staff phone to a CRM user
    let staffUserId: string | null = null;
    if (staff_phone) {
      const staffMatch = await query(
        `SELECT id FROM users WHERE tenant_id=$1::uuid AND phone=$2 AND is_active=TRUE LIMIT 1`,
        [tenantId, staff_phone]
      );
      if (staffMatch.rows[0]) staffUserId = staffMatch.rows[0].id;
    }

    // Match caller phone to a lead
    let leadId: string | null = null;
    let leadName: string | null = null;
    let isUnknown = false;
    if (cdr_phone) {
      const leadMatch = await query(
        `SELECT id, name FROM leads WHERE tenant_id=$1::uuid AND phone=$2 AND is_deleted=FALSE
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, cdr_phone]
      );
      if (leadMatch.rows[0]) {
        leadId = leadMatch.rows[0].id;
        leadName = leadMatch.rows[0].name ?? null;
      } else {
        isUnknown = true;
      }
    }

    // Insert call log (deduplicated by tenant + cdr_id)
    const insertResult = await query(
      `INSERT INTO call_logs
         (tenant_id, lead_id, cdr_id, direction, outcome, caller_phone, superfone_number,
          duration_seconds, started_at, ended_at, staff_phone, staff_name, staff_user_id,
          ivr_inputs, recording_url, is_unknown)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
       ON CONFLICT (tenant_id, cdr_id) DO NOTHING
       RETURNING id`,
      [
        tenantId,
        leadId,
        cdr_id,
        (cdr_call_type ?? 'INBOUND').toUpperCase(),
        (cdr_disposition ?? 'UNKNOWN').toUpperCase(),
        cdr_phone ?? null,
        superfone_number ?? null,
        cdr_duration ?? null,
        cdr_start ?? null,
        cdr_end ?? null,
        staff_phone ?? null,
        staffName,
        staffUserId,
        JSON.stringify(ivr_inputs ?? []),
        recording_url ?? null,
        isUnknown,
      ]
    );

    // If duplicate (ON CONFLICT DO NOTHING), insertResult.rows is empty — skip
    if (!insertResult.rows[0]) return;

    const callLogId = insertResult.rows[0].id;

    // Emit real-time event to tenant
    emitToTenant(tenantId, 'call:logged', {
      id: callLogId,
      leadId,
      isUnknown,
      direction: (cdr_call_type ?? 'INBOUND').toUpperCase(),
      outcome: (cdr_disposition ?? 'UNKNOWN').toUpperCase(),
      callerPhone: cdr_phone,
      duration: cdr_duration,
      staffName,
      startedAt: cdr_start,
    });

    // In-app notification to staff + owner/managers
    sendCallLoggedNotification(tenantId, {
      id: callLogId,
      leadId,
      leadName,
      isUnknown,
      direction: (cdr_call_type ?? 'INBOUND').toUpperCase(),
      outcome: (cdr_disposition ?? 'UNKNOWN').toUpperCase(),
      callerPhone: cdr_phone ?? null,
      duration: cdr_duration ?? null,
      staffName,
      staffUserId,
    }).catch(() => null);

  } catch (err: any) {
    console.error('[superfone webhook]', err.message);
  }
});

export default router;
