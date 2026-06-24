import { Router, Request, Response } from 'express';
import { query } from '../db';
import { triggerWorkflows } from './workflows';
import { decrypt } from '../utils/crypto';
import { parseMetaFieldData } from '../utils/meta';
import { upsertContact } from '../utils/contacts';
import { emitToTenant } from '../socket';
import { sendNewLeadNotification, sendCallLoggedNotification } from '../utils/notifications';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import https from 'https';

const WA_MEDIA_DIR = process.env.WA_MEDIA_DIR || path.join(process.cwd(), 'wa_media');

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

// Download WABA media by ID → save to disk → return relative path
async function downloadWabaMedia(
  mediaId: string, token: string, tenantId: string, ext: string
): Promise<string | null> {
  try {
    // Step 1: get the media URL from Meta
    const meta = await graphGet(`/${mediaId}`, token);
    const url: string | undefined = meta?.url;
    if (!url) return null;

    // Step 2: download the binary
    const data = await new Promise<Buffer>((resolve, reject) => {
      const parsed = new URL(url);
      https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { Authorization: `Bearer ${token}` } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });

    // Step 3: save to disk
    const dir = path.join(WA_MEDIA_DIR, tenantId);
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    fs.writeFileSync(path.join(dir, filename), data);
    return `wa_media/${tenantId}/${filename}`;
  } catch (e: any) {
    console.error('[WABA media download]', e?.message ?? e);
    return null;
  }
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

        // 4. Email/phone dedup — PIPELINE-SCOPED
        const pipelineId = row.pipeline_id ?? null;
        const dedupParams: any[] = [row.tenant_id, email, phone];
        let dedupSql = `SELECT id FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE
           AND (($2::text<>'' AND LOWER(email)=$2) OR ($3::text<>'' AND phone=$3))`;
        if (pipelineId) {
          dedupParams.push(pipelineId);
          dedupSql += ` AND pipeline_id=$${dedupParams.length}::uuid`;
        }
        dedupSql += ` LIMIT 1`;
        const existing = (email || phone) ? await query(dedupSql, dedupParams) : { rows: [] };

        let leadId: string | null = null;
        let isNew = false;
        const isDuplicate = !!existing.rows[0];

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
            [row.tenant_id, name, email, phone, leadgenId, pipelineId, row.stage_id ?? null]
          );
          leadId = ins.rows[0]?.id;
          if (ins.rows[0]) {
            emitToTenant(row.tenant_id, 'lead:created', ins.rows[0]);
            sendNewLeadNotification(row.tenant_id, ins.rows[0], null).catch(() => null);
          }
        }

        // Log to enquiry_log — every submission, even duplicates
        if (leadId) {
          // Fetch pipeline/stage names for the log
          let pName: string | null = null;
          let sName: string | null = null;
          if (pipelineId) {
            const pRes = await query('SELECT name FROM pipelines WHERE id=$1::uuid', [pipelineId]);
            pName = pRes.rows[0]?.name ?? null;
          }
          if (row.stage_id) {
            const sRes = await query('SELECT name FROM pipeline_stages WHERE id=$1::uuid', [row.stage_id]);
            sName = sRes.rows[0]?.name ?? null;
          }
          await query(
            `INSERT INTO enquiry_log (tenant_id, phone, email, lead_id, form_type, form_id, form_name, pipeline_id, pipeline_name, stage_id, stage_name, source, is_duplicate, raw_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [row.tenant_id, phone || null, email || null, leadId, 'meta_form', row.form_id, row.form_name,
             pipelineId, pName, row.stage_id ?? null, sName, 'meta_form', isDuplicate,
             JSON.stringify({ leadgen_id: leadgenId, field_data: fieldData })]
          ).catch((e) => console.error('[enquiry_log meta]', e.message));
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
  console.log('[WABA webhook GET] verify request:', req.query);
  const mode      = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  // Accept any subscribe challenge — the WABA may be owned by a different Meta app
  // whose verify_token we don't control (override_callback_uri scenario)
  if (mode === 'subscribe' && challenge) {
    console.log('[WABA webhook GET] verified OK');
    res.status(200).send(challenge);
  } else {
    console.warn('[WABA webhook GET] not a subscribe request');
    res.status(403).send('Forbidden');
  }
});

// ── WhatsApp Inbound ──────────────────────────────────────────────────────────

router.post('/whatsapp', (req: Request, res: Response) => {
  console.log('[WABA webhook POST] hit, body length:', (req.body as Buffer)?.length ?? 0);
  res.status(200).send('EVENT_RECEIVED');

  const sig       = req.headers['x-hub-signature-256'] as string | undefined;
  const appSecret = process.env.META_APP_SECRET;
  if (appSecret && sig) {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(req.body as Buffer)
      .digest('hex');
    if (sig !== expected) {
      // WABA may be owned by a different Meta app — don't silently drop
      console.warn('[WABA webhook] Signature mismatch (different app secret?) — processing anyway');
    }
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

        // ── Handle template status updates (approved/rejected) ─────────
        if (change.field === 'message_template_status_update') {
          const ev = change.value ?? {};
          const metaName: string = ev.message_template_name ?? '';
          const newStatus: string = ev.event ?? ''; // APPROVED | REJECTED | PENDING_DELETION | ...
          if (metaName && newStatus) {
            const mapped = newStatus === 'APPROVED' ? 'approved'
              : newStatus === 'REJECTED' ? 'rejected'
              : newStatus === 'PENDING_DELETION' ? 'rejected'
              : null;
            if (mapped) {
              const updated = await query(
                `UPDATE templates SET status=$1, updated_at=NOW()
                 WHERE meta_name=$2 AND template_type='waba'
                 RETURNING id, tenant_id, name, status`,
                [mapped, metaName]
              );
              for (const row of updated.rows) {
                console.log(`[WABA] Template "${metaName}" status → ${mapped} (tenant ${row.tenant_id})`);
                emitToTenant(row.tenant_id, 'template:status_updated', {
                  id: row.id, name: row.name, status: mapped,
                });
              }
            }
          }
          continue;
        }

        const value = change.value ?? {};

        const phoneNumberId: string = value.metadata?.phone_number_id;
        const wabaDisplayPhone: string = value.metadata?.display_phone_number ?? '';
        if (!phoneNumberId) continue;

        const wabaRes = await query(
          'SELECT tenant_id, phone_number FROM waba_integrations WHERE phone_number_id=$1 AND is_active=TRUE LIMIT 1',
          [phoneNumberId]
        );
        const waba = wabaRes.rows[0];
        if (!waba) continue;
        const tenantId: string = waba.tenant_id;
        const wabaPhone: string = waba.phone_number || wabaDisplayPhone;

        // ── Handle delivery status updates ──────────────────────────────
        const statuses: any[] = value.statuses ?? [];
        if (statuses.length > 0) console.log('[WABA webhook] status updates:', statuses.length, 'for tenant', tenantId);
        for (const st of statuses) {
          const wamid: string | undefined = st.id;
          const statusVal: string | undefined = st.status; // sent | delivered | read | failed
          if (!wamid || !statusVal) continue;
          console.log('[WABA webhook] wamid:', wamid, 'status:', statusVal);

          // Map Meta status to our DB status
          const mapped = statusVal === 'read' ? 'read'
            : statusVal === 'delivered' ? 'delivered'
            : statusVal === 'sent' ? 'sent'
            : statusVal === 'failed' ? 'failed'
            : null;
          if (!mapped) continue;

          // Only upgrade status: sent → delivered → read (never downgrade)
          // Failed always overrides
          const statusRank: Record<string, number> = { failed: 0, sent: 1, delivered: 2, read: 3 };
          const rank = statusRank[mapped] ?? 0;

          // Extract error reason for failed messages
          const errorReason = mapped === 'failed' && st.errors?.length
            ? (st.errors[0]?.title ?? st.errors[0]?.message ?? 'Delivery failed')
            : null;

          const updateRes = await query(
            `UPDATE messages SET status=$1, error_reason=COALESCE($5, error_reason), updated_at=NOW()
             WHERE wamid=$2 AND tenant_id=$3
               AND (
                 $1='failed'
                 OR COALESCE((CASE status WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END), 0) < $4
               )
             RETURNING id, conversation_id, status, broadcast_id`,
            [mapped, wamid, tenantId, rank, errorReason]
          );

          if (updateRes.rows[0]) {
            emitToTenant(tenantId, 'message:updated', {
              id: updateRes.rows[0].id,
              status: mapped,
              error_reason: errorReason,
              conversation_id: updateRes.rows[0].conversation_id,
            });

            // Update broadcast delivery counters if this message belongs to a broadcast
            const bcId = updateRes.rows[0].broadcast_id;
            if (bcId) {
              if (mapped === 'delivered') {
                await query('UPDATE broadcasts SET delivered = delivered + 1 WHERE id = $1::uuid', [bcId]);
              } else if (mapped === 'read') {
                await query('UPDATE broadcasts SET read_count = read_count + 1 WHERE id = $1::uuid', [bcId]);
              } else if (mapped === 'failed') {
                await query(
                  'UPDATE broadcasts SET failed = failed + 1, sent = GREATEST(sent - 1, 0) WHERE id = $1::uuid',
                  [bcId],
                );
              }
            }
          }

          if (errorReason) {
            console.error(`[WABA status] Message ${wamid} failed: ${errorReason}`);
          }
        }

        // ── Handle inbound messages ─────────────────────────────────────
        const messages: any[] = value.messages ?? [];
        if (!messages.length) continue;

        // Extract contact profile name from webhook payload
        const contacts: any[] = value.contacts ?? [];
        const profileNameMap: Record<string, string> = {};
        for (const c of contacts) {
          if (c.wa_id && c.profile?.name) profileNameMap[c.wa_id] = c.profile.name;
        }

        // Fetch WABA access token for media downloads
        let wabaToken: string | null = null;
        try {
          const tokenRes = await query(
            'SELECT access_token FROM waba_integrations WHERE tenant_id=$1 AND is_active=TRUE LIMIT 1',
            [tenantId]
          );
          if (tokenRes.rows[0]) wabaToken = decrypt(tokenRes.rows[0].access_token);
        } catch { /* ignore */ }

        for (const msg of messages) {
          const waPhone: string = msg.from;
          const wamid: string   = msg.id;
          const msgType: string = msg.type ?? 'text';
          console.log(`[WABA inbound] from=${waPhone} type=${msgType} wamid=${wamid} profile=${profileNameMap[waPhone] ?? 'unknown'}`);

          // Extract media ID + extension for download
          const mediaObj = msg.image ?? msg.document ?? msg.video ?? msg.audio ?? msg.sticker ?? null;
          const mediaId: string | null = mediaObj?.id ?? null;
          const mimeType: string = mediaObj?.mime_type ?? '';
          const extMap: Record<string, string> = {
            'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
            'video/mp4': '.mp4', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3',
            'application/pdf': '.pdf',
          };
          const ext = extMap[mimeType] || (mimeType ? `.${mimeType.split('/')[1]?.split(';')[0] ?? 'bin'}` : '.bin');

          // Handle interactive responses (button replies, list selections)
          const interactiveReply =
            msg.interactive?.button_reply?.title
            ?? msg.interactive?.list_reply?.title
            ?? null;

          const content: string =
            msg.text?.body
            ?? interactiveReply
            ?? msg.image?.caption
            ?? (msg.document?.filename ? `[Document: ${msg.document.filename}]` : null)
            ?? (msgType === 'image' ? '[Image]' : null)
            ?? (msgType === 'video' ? '[Video]' : null)
            ?? (msgType === 'audio' ? '[Audio]' : null)
            ?? (msgType === 'sticker' ? '[Sticker]' : null)
            ?? (msgType === 'interactive' ? (interactiveReply || '[Interactive]') : null)
            ?? `[${msgType}]`;

          // Dedup by wamid
          const dupMsg = await query('SELECT id FROM messages WHERE wamid=$1 LIMIT 1', [wamid]);
          if (dupMsg.rows[0]) continue;

          // Download media from Meta (fire-and-forget style — save path now, download async)
          let mediaPath: string | null = null;
          if (mediaId && wabaToken) {
            mediaPath = await downloadWabaMedia(mediaId, wabaToken, tenantId, ext);
          }

          // Find or create lead (use last-10-digit match like Personal WA handler)
          let leadId: string;
          let leadName: string = waPhone;
          const cleanDigits = waPhone.replace(/\D/g, '');
          const leadRes = await query(
            `SELECT id, name, phone FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE
             AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE '%' || RIGHT($2, 10)
             LIMIT 1`,
            [tenantId, cleanDigits]
          );
          if (leadRes.rows[0]) {
            leadId = leadRes.rows[0].id;
            leadName = leadRes.rows[0].name;
          } else {
            const displayPhone = waPhone.startsWith('+') ? waPhone : `+${waPhone}`;
            const contactName = profileNameMap[waPhone] ?? displayPhone;
            const newLead = await query(
              `INSERT INTO leads (tenant_id, name, phone, source) VALUES ($1,$2,$3,'whatsapp') RETURNING *`,
              [tenantId, contactName, displayPhone]
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

          // Find or create open conversation (check lead_id first, then phone fallback)
          let convId: string;
          const convRes = await query(
            `SELECT id FROM conversations WHERE tenant_id=$1 AND channel='whatsapp' AND lead_id=$2 AND status<>'resolved'
             ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
            [tenantId, leadId]
          );
          if (convRes.rows[0]) {
            convId = convRes.rows[0].id;
          } else {
            // Also check phone-based conversations (e.g. created by single-send before lead was linked)
            const phoneConv = await query(
              `SELECT id FROM conversations WHERE tenant_id=$1 AND channel='whatsapp'
               AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE '%' || RIGHT($2, 10)
               ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
              [tenantId, cleanDigits]
            );
            if (phoneConv.rows[0]) {
              convId = phoneConv.rows[0].id;
              // Link lead to existing conversation
              await query('UPDATE conversations SET lead_id=$1 WHERE id=$2 AND lead_id IS NULL', [leadId, convId]).catch(() => null);
            } else {
              const newConv = await query(
                `INSERT INTO conversations (tenant_id, lead_id, channel, status, unread_count, last_message, last_message_at, phone)
                 VALUES ($1,$2,'whatsapp','open',1,$3,NOW(),$4) RETURNING id`,
                [tenantId, leadId, content, waPhone]
              );
              convId = newConv.rows[0].id;
            }
          }

          const msgRes = await query(
            `INSERT INTO messages (conversation_id, tenant_id, lead_id, sender, body, is_note, wamid, media_url, status, sent_by, created_at)
             VALUES ($1,$2,$3,'customer',$4,FALSE,$5,$6,'delivered','customer',NOW()) RETURNING *`,
            [convId, tenantId, leadId, content, wamid, mediaPath]
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
              { triggerContext: { channel: 'whatsapp', messageBody: content, waPhone: wabaPhone } }
            ).catch(() => null)
          );

          // Fire template_button_clicked for Quick Reply button taps (msg.type === 'button')
          // and interactive button replies (msg.interactive?.button_reply)
          const buttonPayload = msg.button?.text ?? msg.button?.payload
            ?? msg.interactive?.button_reply?.title ?? msg.interactive?.button_reply?.id
            ?? null;
          if (buttonPayload) {
            // Try to find which template was sent to this lead recently (last outbound template message)
            let templateName = '';
            try {
              const tplMsg = await query(
                `SELECT body FROM messages WHERE lead_id=$1 AND tenant_id=$2 AND sender='agent' AND body LIKE '[Template:%' ORDER BY created_at DESC LIMIT 1`,
                [leadId, tenantId]
              );
              if (tplMsg.rows[0]?.body) {
                const match = tplMsg.rows[0].body.match(/\[Template: ([^\]]+)\]/);
                if (match) templateName = match[1];
              }
            } catch { /* ignore */ }

            setImmediate(() =>
              triggerWorkflows('template_button_clicked', lead, tenantId, 'webhook',
                { triggerContext: { buttonPayload: String(buttonPayload), templateName, channel: 'whatsapp', messageBody: content, waPhone: wabaPhone } }
              ).catch(() => null)
            );
          }
        }
      }
    }
  } catch (err) {
    console.error('WhatsApp webhook processing error:', err);
  }
}

// ── Superfone Webhook ─────────────────────────────────────────────────────────
// No auth — Superfone POSTs call CDRs directly. Two entry points are defined below:
//   - POST /superfone           platform-wide; give THIS to Superfone. The client is
//     resolved from the Superfone business number in the payload, so one URL serves all.
//   - POST /superfone/:tenantId explicit per-account (backward compatible).

// The destination/virtual Superfone number can arrive under different field names.
function extractSuperfoneNumber(payload: Record<string, any>): string | null {
  const candidates = [
    payload.superfone_number, payload.did, payload.did_number, payload.business_number,
    payload.virtual_number, payload.to, payload.to_number, payload.called_number, payload.destination,
  ];
  const v = candidates.find((x) => x != null && String(x).trim() !== '');
  return v != null ? String(v) : null;
}

// Last 10 digits — tolerant match across +91 / 0-prefix / spacing differences.
function last10Digits(s: string | null | undefined): string {
  return String(s ?? '').replace(/\D/g, '').slice(-10);
}

// Core ingestion — shared by both routes. tenantId is already resolved and authorized.
async function ingestSuperfoneCall(tenantId: string, payload: Record<string, any>): Promise<void> {

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

    // Fire automation triggers for matched leads (skip unknown callers — no lead to attach)
    if (!isUnknown && leadId) {
      const outcome = (cdr_disposition ?? 'UNKNOWN').toUpperCase();
      const triggerKey = outcome === 'ANSWERED' ? 'call_answered'
                       : outcome === 'MISSED'   ? 'call_missed'
                       : null;
      if (triggerKey) {
        const callDirection = (cdr_call_type ?? 'INBOUND').toUpperCase();
        setImmediate(() => triggerWorkflows(
          triggerKey,
          { id: leadId, name: leadName ?? '' },
          tenantId,
          staffUserId ?? 'webhook',
          { triggerContext: { callDirection } }
        ).catch(() => null));
      }
    }

}

// ── Routes ───────────────────────────────────────────────────────────────────

// Platform-wide endpoint — GIVE THIS ONE TO SUPERFONE.
// One URL for the whole white-label platform: the client is resolved from the
// Superfone business number carried in each call's payload.
router.post('/superfone', async (req: Request, res: Response) => {
  const payload = req.body as Record<string, any>;
  res.status(200).json({ received: true }); // ack immediately so Superfone doesn't retry
  try {
    const num = extractSuperfoneNumber(payload);
    if (!num) { console.warn('[superfone webhook] payload has no business number — cannot route'); return; }
    const tail = last10Digits(num);
    if (tail.length < 7) { console.warn('[superfone webhook] business number too short:', num); return; }
    // Resolve the owning tenant by its registered Superfone number (connected + enabled only).
    const match = await query(
      `SELECT s.tenant_id FROM superfone_settings s
       JOIN tenants t ON t.id = s.tenant_id
       WHERE s.is_connected=TRUE AND t.superfone_enabled=TRUE
         AND RIGHT(regexp_replace(s.superfone_number, '\\D', '', 'g'), 10) = $1
       LIMIT 1`,
      [tail]
    );
    if (!match.rows[0]) { console.warn('[superfone webhook] no enabled tenant for number', num); return; }
    await ingestSuperfoneCall(match.rows[0].tenant_id, payload);
  } catch (err: any) {
    console.error('[superfone webhook]', err.message);
  }
});

// Explicit per-account endpoint (backward compatible) — tenant identified in the URL.
router.post('/superfone/:tenantId', async (req: Request, res: Response) => {
  const { tenantId } = req.params;
  const payload = req.body as Record<string, any>;
  res.status(200).json({ received: true });
  try {
    const ok = await query(
      `SELECT 1 FROM superfone_settings s
       JOIN tenants t ON t.id = s.tenant_id
       WHERE s.tenant_id=$1::uuid AND s.is_connected=TRUE AND t.superfone_enabled=TRUE`,
      [tenantId]
    );
    if (!ok.rows[0]) return;
    await ingestSuperfoneCall(tenantId, payload);
  } catch (err: any) {
    console.error('[superfone webhook]', err.message);
  }
});

export default router;
