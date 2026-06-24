import path from 'path';
import fs from 'fs';
import { Router, Response } from 'express';
import multer from 'multer';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission, checkAnyPermission, hasPermission } from '../middleware/permissions';
import { maskPhone } from '../utils/phone';
import { decrypt } from '../utils/crypto';
import { emitToTenant } from '../socket';
import https from 'https';
import { sendText, sendMedia, getSession, getWAContacts } from '../services/whatsapp/sessionManager';
import { toJID, normalizePhone } from '../services/whatsapp/phoneUtils';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

const WA_MEDIA_DIR = process.env.WA_MEDIA_DIR || path.join(process.cwd(), 'wa_media');

// Multer: store uploads in memory (max 25 MB — WA limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function sendWARequest(phoneNumberId: string, token: string, payload: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'graph.facebook.com',
      path: `/v17.0/${phoneNumberId}/messages`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendWAMessage(phoneNumberId: string, token: string, toPhone: string, text: string): Promise<any> {
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
  components: Array<{ type: string; sub_type?: string; index?: number; parameters: Array<{ type: string; text?: string }> }>
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
  // Only include components if there are parameters to fill
  const withParams = components.filter((c) => c.parameters && c.parameters.length > 0);
  if (withParams.length > 0) {
    tplPayload.template.components = withParams;
  }
  console.log('[sendWATemplate]', templateName, JSON.stringify(tplPayload.template.components ?? 'no-components'));
  return sendWARequest(phoneNumberId, token, tplPayload);
}

// Interpolate CRM variables in template text and component parameters.
// Supports {first_name}, {last_name}, {full_name}, {phone}, {email},
// and the {%var%} variant users sometimes type.
function interpolateVars(text: string, lead: { name?: string | null; phone?: string | null; email?: string | null }): string {
  const fullName = (lead.name ?? '').trim();
  const parts = fullName.split(/\s+/);
  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ');
  return text
    .replace(/\{%?first_name%?\}/gi, firstName)
    .replace(/\{%?last_name%?\}/gi, lastName)
    .replace(/\{%?full_name%?\}/gi, fullName)
    .replace(/\{%?phone%?\}/gi, lead.phone ?? '')
    .replace(/\{%?email%?\}/gi, lead.email ?? '');
}

// Resolve a single CRM field key to its value for a given lead context.
function resolveVarKey(key: string, lead: { name?: string | null; phone?: string | null; email?: string | null }): string {
  const fullName = (lead.name ?? '').trim();
  const parts = fullName.split(/\s+/);
  switch (key) {
    case 'first_name': return parts[0] ?? '';
    case 'last_name': return parts.slice(1).join(' ');
    case 'full_name': return fullName;
    case 'phone': return lead.phone ?? '';
    case 'email': return lead.email ?? '';
    case 'today': return new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    default: return `[${key}]`;
  }
}

// Build Meta API send-time components from saved var_mapping and template texts.
// Handles body, header, and button URL variables.
function buildComponentsFromMapping(
  bodyText: string,
  variables: any,
  lead: { name?: string | null; phone?: string | null; email?: string | null },
  headerText?: string | null,
  metaComponents?: any,
): Array<{ type: string; sub_type?: string; index?: number; parameters: Array<{ type: string; text: string }> }> {
  const vars = typeof variables === 'string' ? (() => { try { return JSON.parse(variables); } catch { return null; } })() : variables;
  const varMapping: Record<string, string> = vars?.var_mapping ?? {};
  const components: Array<{ type: string; sub_type?: string; index?: number; parameters: Array<{ type: string; text: string }> }> = [];

  // Helper: extract unique {{N}} numbers from text, sorted ascending
  const extractVarNums = (text: string): string[] =>
    Array.from(text.matchAll(/\{\{(\d+)\}\}/g))
      .map((m) => m[1])
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => Number(a) - Number(b));

  // Header variables (e.g. "Hello {{1}}")
  if (headerText) {
    const headerNums = extractVarNums(headerText);
    if (headerNums.length > 0) {
      const params = headerNums.map((n) => {
        const crmKey = varMapping[`h${n}`] || varMapping[n];
        return { type: 'text' as const, text: crmKey ? resolveVarKey(crmKey, lead) : resolveVarKey('full_name', lead) || 'there' };
      });
      components.push({ type: 'header', parameters: params });
    }
  }

  // Body variables
  const bodyNums = extractVarNums(bodyText);
  if (bodyNums.length > 0) {
    const params = bodyNums.map((n) => {
      const crmKey = varMapping[n];
      const resolved = crmKey ? resolveVarKey(crmKey, lead) : resolveVarKey('full_name', lead) || 'there';
      return { type: 'text' as const, text: resolved };
    });
    components.push({ type: 'body', parameters: params });
  }
  // Note: old {var}/{%var%} style templates don't have Meta {{N}} variables,
  // so we intentionally send NO body components for them (Meta expects 0 params).

  // Button URL variables (dynamic URL suffix)
  if (metaComponents) {
    const parsed = typeof metaComponents === 'string' ? (() => { try { return JSON.parse(metaComponents); } catch { return null; } })() : metaComponents;
    if (Array.isArray(parsed)) {
      const buttonsComp = parsed.find((c: any) => c.type === 'BUTTONS');
      if (buttonsComp?.buttons) {
        (buttonsComp.buttons as any[]).forEach((btn: any, idx: number) => {
          if (btn.type === 'URL' && btn.url && /\{\{\d+\}\}/.test(btn.url)) {
            components.push({
              type: 'button', sub_type: 'url', index: idx,
              parameters: [{ type: 'text', text: '' }],
            });
          }
        });
      }
    }
  }

  console.log('[buildComponentsFromMapping] body vars:', bodyNums, 'header vars:', headerText ? extractVarNums(headerText) : [], 'components:', JSON.stringify(components));
  return components;
}

function interpolateComponents(
  components: Array<{ type: string; parameters: Array<{ type: string; text?: string }> }>,
  lead: { name?: string | null; phone?: string | null; email?: string | null },
): Array<{ type: string; parameters: Array<{ type: string; text?: string }> }> {
  return components.map((c) => ({
    ...c,
    parameters: (c.parameters ?? []).map((p) => ({
      ...p,
      text: p.text ? interpolateVars(p.text, lead) : p.text,
    })),
  }));
}

function sendWAMedia(
  phoneNumberId: string, token: string, toPhone: string,
  mediaType: 'image' | 'document' | 'video' | 'audio',
  mediaUrl: string, caption?: string, filename?: string,
): Promise<any> {
  const mediaObj: any = { link: mediaUrl };
  if (caption) mediaObj.caption = caption;
  if (filename && mediaType === 'document') mediaObj.filename = filename;
  return sendWARequest(phoneNumberId, token, {
    messaging_product: 'whatsapp',
    to: toPhone.replace(/\D/g, ''),
    type: mediaType,
    [mediaType]: mediaObj,
  });
}

function sendWAInteractive(
  phoneNumberId: string, token: string, toPhone: string,
  interactiveType: 'button' | 'list',
  bodyText: string,
  buttons?: Array<{ id: string; title: string }>,
  sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>,
  headerText?: string, footerText?: string, listButtonText?: string,
): Promise<any> {
  const interactive: any = {
    type: interactiveType,
    body: { text: bodyText },
  };
  if (headerText) interactive.header = { type: 'text', text: headerText };
  if (footerText) interactive.footer = { text: footerText };

  if (interactiveType === 'button' && buttons?.length) {
    interactive.action = {
      buttons: buttons.slice(0, 3).map((b) => ({
        type: 'reply',
        reply: { id: b.id, title: b.title.slice(0, 20) },
      })),
    };
  } else if (interactiveType === 'list' && sections?.length) {
    interactive.action = {
      button: (listButtonText || 'View Options').slice(0, 20),
      sections: sections.map((s) => ({
        title: s.title,
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title.slice(0, 24),
          description: r.description?.slice(0, 72),
        })),
      })),
    };
  }

  return sendWARequest(phoneNumberId, token, {
    messaging_product: 'whatsapp',
    to: toPhone.replace(/\D/g, ''),
    type: 'interactive',
    interactive,
  });
}

// GET /api/conversations/wa-contacts?q=name — search WA phone-book contacts (cached from Baileys)
router.get('/wa-contacts', checkPermission('inbox:send'), async (req: AuthRequest, res: Response) => {
  const q = ((req.query.q as string) ?? '').toLowerCase().trim();
  const all = getWAContacts(req.user!.tenantId!);
  const result = q
    ? all.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q))
    : all.slice(0, 50);
  res.json(result.slice(0, 50));
});

// POST /api/conversations/new — start a new personal WA conversation by phone number
router.post('/new', checkPermission('inbox:send'), async (req: AuthRequest, res: Response) => {
  const { phone, body } = req.body as { phone?: string; body?: string };
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    res.status(400).json({ error: 'Invalid phone number' }); return;
  }
  if (!body?.trim()) {
    res.status(400).json({ error: 'body required' }); return;
  }

  try {
    const { tenantId } = req.user!;

    // Always work with normalized phone (with country code) to match what Baileys produces
    const normPhone = normalizePhone(digits);

    // Look up lead by last-10-digit match
    const leadRes = await query(
      `SELECT id, name, phone, assigned_to FROM leads
       WHERE tenant_id=$1::uuid AND is_deleted=FALSE
         AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE '%' || RIGHT($2, 10)
       LIMIT 1`,
      [tenantId, normPhone],
    );
    const lead   = leadRes.rows[0] ?? null;
    const leadId = lead?.id ?? null;

    // Find or create conversation — use last-10-digit match so format differences never create duplicates
    let convId: string;
    if (leadId) {
      const ex = await query(
        `SELECT id FROM conversations WHERE tenant_id=$1::uuid AND channel='personal_wa' AND lead_id=$2::uuid
         ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
        [tenantId, leadId],
      );
      if (ex.rows[0]) {
        convId = ex.rows[0].id;
      } else {
        const nc = await query(
          `INSERT INTO conversations (tenant_id, lead_id, channel, status, unread_count, last_message_at)
           VALUES ($1::uuid, $2::uuid, 'personal_wa', 'open', 0, NOW()) RETURNING id`,
          [tenantId, leadId],
        );
        convId = nc.rows[0].id;
      }
    } else {
      const ex = await query(
        `SELECT id FROM conversations
         WHERE tenant_id=$1::uuid AND channel='personal_wa' AND lead_id IS NULL
           AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE '%' || RIGHT($2, 10)
         ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
        [tenantId, normPhone],
      );
      if (ex.rows[0]) {
        convId = ex.rows[0].id;
        // Normalize the stored phone while we're here
        await query(
          `UPDATE conversations SET phone=$1 WHERE id=$2 AND phone IS DISTINCT FROM $1`,
          [normPhone, convId],
        ).catch(() => null);
      } else {
        const nc = await query(
          `INSERT INTO conversations (tenant_id, lead_id, channel, status, unread_count, last_message_at, phone)
           VALUES ($1::uuid, NULL, 'personal_wa', 'open', 0, NOW(), $2) RETURNING id`,
          [tenantId, normPhone],  // store normalized phone — matches Baileys format
        );
        convId = nc.rows[0].id;
      }
    }

    // Send via Baileys
    const jid = toJID(normPhone);
    let wamid: string | null = null;
    let deliveryFailed = false;
    try {
      wamid = await sendText(tenantId!, jid, body.trim());
    } catch (e: any) {
      console.error('[Personal WA] New chat send error:', e?.message ?? e);
      deliveryFailed = true;
    }

    const msgStatus = deliveryFailed ? 'failed' : 'sent';
    const msgRes = await query(
      `INSERT INTO messages (conversation_id, tenant_id, lead_id, sender, body, is_note, wamid, status, sent_by, created_at)
       VALUES ($1,$2,$3,'agent',$4,FALSE,$5,$6,'manual',NOW()) RETURNING *`,
      [convId, tenantId, leadId, body.trim(), wamid, msgStatus],
    );
    await query(
      `UPDATE conversations SET last_message=$1, last_message_at=NOW(), unread_count=0 WHERE id=$2`,
      [body.trim(), convId],
    );

    emitToTenant(tenantId!, 'message:new', msgRes.rows[0]);

    res.status(201).json({ conversation_id: convId, message: msgRes.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/conversations
router.get('/', checkAnyPermission('inbox:view_all','inbox:send'), async (req: AuthRequest, res: Response) => {
  const { userId, tenantId, role } = req.user!;
  const { status, assigned_to, search, wa_account } = req.query as Record<string, string>;
  const isSuperAdmin = role === 'super_admin';

  let viewAll = isSuperAdmin;
  if (!isSuperAdmin) {
    try {
      const ownerRes = await query('SELECT is_owner FROM users WHERE id=$1', [userId]);
      if (ownerRes.rows[0]?.is_owner) {
        viewAll = true;
      } else {
        viewAll = await hasPermission(userId, 'inbox:view_all', tenantId);
      }
    } catch { viewAll = false; }
  }

  // Format anonymous phone as +E164 for display; leads.phone is shown as-is (already formatted)
  let sql = `
    SELECT c.*,
           COALESCE(l.name, CASE WHEN LENGTH(REGEXP_REPLACE(COALESCE(c.phone,''),'[^0-9]','','g')) >= 14 THEN 'WA Contact (' || RIGHT(REGEXP_REPLACE(c.phone,'[^0-9]','','g'),6) || ')' ELSE '+' || c.phone END, 'Unknown') AS lead_name,
           COALESCE(l.phone, '+' || c.phone)             AS lead_phone,
           u.name AS assigned_name
    FROM conversations c
    LEFT JOIN leads l ON l.id = c.lead_id
    LEFT JOIN users u ON u.id = c.assigned_to
    WHERE c.tenant_id = $1
  `;
  const params: any[] = [tenantId];

  if (!viewAll) {
    const userIdx = params.push(userId);
    sql += ` AND (c.assigned_to = $${userIdx} OR l.assigned_to = $${userIdx})`;
  }

  if (status)      { params.push(status);        sql += ` AND c.status = $${params.length}`; }
  if (assigned_to) { params.push(assigned_to);   sql += ` AND c.assigned_to = $${params.length}`; }
  if (wa_account)  { params.push(wa_account);    sql += ` AND c.wa_account = $${params.length}`; }
  // Search by lead name OR anonymous phone
  if (search) {
    params.push(`%${search}%`);
    sql += ` AND (l.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`;
  }
  sql += ' ORDER BY c.last_message_at DESC NULLS LAST';

  try {
    const result = await query(sql, params);
    let rows = result.rows;
    if (!isSuperAdmin) {
      let shouldMask = false;
      try { shouldMask = await hasPermission(userId, 'leads:mask_phone', tenantId); } catch {}
      if (shouldMask) rows = rows.map((r: any) => ({ ...r, lead_phone: maskPhone(r.lead_phone) }));
    }
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/conversations/media/:msgId — serve downloaded WA media with auth
router.get('/media/:msgId', async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.user!;
    const msgRes = await query(
      `SELECT media_url FROM messages WHERE id=$1 AND tenant_id=$2`,
      [req.params.msgId, tenantId],
    );
    const relPath = msgRes.rows[0]?.media_url;
    if (!relPath) { res.status(404).json({ error: 'Media not found' }); return; }

    const filePath = path.join(process.cwd(), relPath);
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }

    res.sendFile(filePath);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/conversations/:id/messages
// Supports: ?limit=50&before=<ISO timestamp> for cursor-based pagination
router.get('/:id/messages', checkAnyPermission('inbox:view_all','inbox:send'), async (req: AuthRequest, res: Response) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const before = req.query.before as string | undefined;

    const params: any[] = [req.params.id, req.user!.tenantId];
    let sql = `SELECT * FROM messages WHERE conversation_id=$1 AND tenant_id=$2`;

    if (before) {
      params.push(before);
      sql += ` AND created_at < $${params.length}::timestamptz`;
    }

    params.push(limit);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const result = await query(sql, params);
    res.json(result.rows.reverse()); // return ascending (oldest first)
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/conversations/:id/messages
router.post('/:id/messages', checkPermission('inbox:send'), async (req: AuthRequest, res: Response) => {
  const { body, is_note, template_id, template_params } = req.body as {
    body?: string; is_note?: boolean;
    template_id?: string;
    template_params?: Array<{ type: string; parameters: Array<{ type: string; text?: string }> }>;
  };
  if (!template_id && !body?.trim()) { res.status(400).json({ error: 'body required' }); return; }
  try {
    const convRes = await query(
      `SELECT c.*, COALESCE(l.phone, c.phone) AS lead_phone, l.name AS lead_name, l.email AS lead_email
       FROM conversations c
       LEFT JOIN leads l ON l.id = c.lead_id
       WHERE c.id=$1 AND c.tenant_id=$2`,
      [req.params.id, req.user!.tenantId],
    );
    if (!convRes.rows[0]) { res.status(404).json({ error: 'Conversation not found' }); return; }
    const conv = convRes.rows[0];
    const leadCtx = { name: conv.lead_name, phone: conv.lead_phone, email: conv.lead_email };

    let wamid: string | null = null;
    let messageBody = body?.trim() ?? '';

    // Send via WABA — template or text
    if (!is_note && conv.channel === 'whatsapp' && conv.lead_phone) {
      try {
        const wabaRes = await query(
          'SELECT phone_number_id, access_token FROM waba_integrations WHERE tenant_id=$1 AND is_active=TRUE',
          [req.user!.tenantId],
        );
        if (wabaRes.rows[0]) {
          const { phone_number_id, access_token: encToken } = wabaRes.rows[0];
          const token = decrypt(encToken);

          if (template_id) {
            // Send as template message
            const tplRes = await query(
              'SELECT meta_name, language, body, header, variables, meta_components FROM templates WHERE id=$1::uuid AND tenant_id=$2::uuid',
              [template_id, req.user!.tenantId],
            );
            const tpl = tplRes.rows[0];
            if (tpl?.meta_name) {
              // Use explicit template_params if provided, else build from saved var_mapping
              const resolvedParams = (template_params && template_params.length > 0)
                ? interpolateComponents(template_params, leadCtx)
                : buildComponentsFromMapping(tpl.body ?? '', tpl.variables, leadCtx, tpl.header, tpl.meta_components);
              const waResp = await sendWATemplate(
                phone_number_id, token, conv.lead_phone,
                tpl.meta_name, tpl.language ?? 'en',
                resolvedParams,
              );
              wamid = waResp?.messages?.[0]?.id ?? null;
              if (waResp?.error) {
                console.error('WABA template send error:', waResp.error);
                res.status(400).json({ error: `WhatsApp error: ${waResp.error.message}` });
                return;
              }
              // Build display body from template for message storage
              if (!messageBody) messageBody = interpolateVars(tpl.body ?? tpl.meta_name, leadCtx);
            }
          } else {
            // Send as plain text
            const waResp = await sendWAMessage(phone_number_id, token, conv.lead_phone, messageBody);
            wamid = waResp?.messages?.[0]?.id ?? null;
          }
        }
      } catch (e) { console.error('WABA send error:', e); }
    }

    // Send via Personal WhatsApp (Baileys)
    let deliveryFailed = false;
    if (!is_note && conv.channel === 'personal_wa') {
      if (!conv.lead_phone) {
        console.error('[Personal WA] No phone on conversation', req.params.id);
        deliveryFailed = true;
      } else {
        try {
          // For multi-device WA contacts the conversation phone is a raw LID digit string.
          // Use the remote_jid stored on their last message so the reply goes to the @lid JID.
          let targetJid = toJID(conv.lead_phone);
          const lidMsgRes = await query(
            `SELECT remote_jid FROM messages
             WHERE conversation_id=$1 AND remote_jid LIKE '%@lid'
             ORDER BY created_at DESC LIMIT 1`,
            [req.params.id],
          ).catch(() => null);
          if (lidMsgRes?.rows[0]?.remote_jid) {
            targetJid = lidMsgRes.rows[0].remote_jid;
          }
          wamid = await sendText(req.user!.tenantId!, targetJid, messageBody);
        } catch (e: any) {
          console.error('[Personal WA] Send error:', e?.message ?? e);
          deliveryFailed = true;
        }
      }
    }

    const msgStatus = (is_note || !deliveryFailed) ? 'sent' : 'failed';
    const msgRes = await query(
      `INSERT INTO messages (conversation_id, tenant_id, lead_id, sender, body, is_note, wamid, status, sent_by, created_at)
       VALUES ($1,$2,$3,'agent',$4,$5,$6,$7,'manual',NOW()) RETURNING *`,
      [req.params.id, req.user!.tenantId, conv.lead_id ?? null, messageBody, is_note ?? false, wamid, msgStatus],
    );

    if (!is_note) {
      await query(
        `UPDATE conversations SET last_message=$1, last_message_at=NOW(), unread_count=0 WHERE id=$2`,
        [messageBody, req.params.id],
      );
      // Emit conversation:updated so all connected clients update the preview and re-sort
      emitToTenant(req.user!.tenantId!, 'conversation:updated', {
        id:              req.params.id,
        last_message:    messageBody,
        last_message_at: new Date().toISOString(),
        unread_count:    0,
      });
    }

    emitToTenant(req.user!.tenantId!, 'message:new', msgRes.rows[0]);
    res.status(201).json(msgRes.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/conversations/:id/media — send a media file via Personal WA or WABA
router.post('/:id/media', checkPermission('inbox:send'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'file required' }); return; }
  const caption = (req.body.caption as string | undefined)?.trim() ?? '';

  try {
    const convRes = await query(
      `SELECT c.*, COALESCE(l.phone, c.phone) AS lead_phone
       FROM conversations c
       LEFT JOIN leads l ON l.id = c.lead_id
       WHERE c.id=$1 AND c.tenant_id=$2`,
      [req.params.id, req.user!.tenantId],
    );
    if (!convRes.rows[0]) { res.status(404).json({ error: 'Conversation not found' }); return; }
    const conv = convRes.rows[0];

    if (conv.channel !== 'personal_wa' && conv.channel !== 'whatsapp') {
      res.status(400).json({ error: 'Media send only supported for WhatsApp channels' }); return;
    }
    if (!conv.lead_phone) {
      res.status(400).json({ error: 'No phone on conversation' }); return;
    }

    // Save file to disk
    const mediaDir = path.join(WA_MEDIA_DIR, req.user!.tenantId!);
    fs.mkdirSync(mediaDir, { recursive: true });
    const ext      = path.extname(req.file.originalname) || '.bin';
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    const filePath = path.join(mediaDir, filename);
    fs.writeFileSync(filePath, req.file.buffer);
    const relPath  = `wa_media/${req.user!.tenantId}/${filename}`;

    let wamid: string | null = null;
    let deliveryFailed = false;

    if (conv.channel === 'whatsapp') {
      // Send via WABA Cloud API
      try {
        const wabaRes = await query(
          'SELECT phone_number_id, access_token FROM waba_integrations WHERE tenant_id=$1 AND is_active=TRUE',
          [req.user!.tenantId],
        );
        if (!wabaRes.rows[0]) { res.status(400).json({ error: 'WABA not connected' }); return; }
        const { phone_number_id, access_token: encToken } = wabaRes.rows[0];
        const token = decrypt(encToken);

        // Build public URL for the saved file
        const baseUrl = process.env.WEBHOOK_BASE_URL || process.env.FRONTEND_URL || '';
        const publicMediaUrl = `${baseUrl}/api/public/waba-media/${req.user!.tenantId}/${filename}`;

        // Determine WABA media type from MIME
        const mt = req.file.mimetype;
        const wabaMediaType: 'image' | 'document' | 'video' | 'audio' =
          mt.startsWith('image/') ? 'image' :
          mt.startsWith('video/') ? 'video' :
          mt.startsWith('audio/') ? 'audio' : 'document';

        const waResp = await sendWAMedia(
          phone_number_id, token, conv.lead_phone,
          wabaMediaType, publicMediaUrl,
          caption || undefined,
          wabaMediaType === 'document' ? req.file.originalname : undefined,
        );
        wamid = waResp?.messages?.[0]?.id ?? null;
        if (waResp?.error) {
          console.error('WABA media send error:', waResp.error);
          deliveryFailed = true;
        }
      } catch (e: any) {
        console.error('[WABA] Media send error:', e?.message ?? e);
        deliveryFailed = true;
      }
    } else {
      // Send via Baileys (Personal WA) — resolve @lid JID the same way as text send
      try {
        let mediaTargetJid = toJID(conv.lead_phone);
        const lidMR = await query(
          `SELECT remote_jid FROM messages WHERE conversation_id=$1 AND remote_jid LIKE '%@lid' ORDER BY created_at DESC LIMIT 1`,
          [req.params.id],
        ).catch(() => null);
        if (lidMR?.rows[0]?.remote_jid) mediaTargetJid = lidMR.rows[0].remote_jid;
        wamid = await sendMedia(
          req.user!.tenantId!,
          mediaTargetJid,
          req.file.buffer,
          req.file.mimetype,
          req.file.originalname,
          caption,
        );
      } catch (e: any) {
        console.error('[Personal WA] Media send error:', e?.message ?? e);
        deliveryFailed = true;
      }
    }

    // Derive message body label
    const mt = req.file.mimetype;
    let body = caption || (
      mt.startsWith('image/') ? '[Image]' :
      mt.startsWith('video/') ? '[Video]' :
      mt.startsWith('audio/') ? '[Audio]' :
      `[Document: ${req.file.originalname}]`
    );

    const msgStatus = deliveryFailed ? 'failed' : 'sent';
    const msgRes = await query(
      `INSERT INTO messages (conversation_id, tenant_id, lead_id, sender, body, is_note, wamid, media_url, status, sent_by, created_at)
       VALUES ($1,$2,$3,'agent',$4,FALSE,$5,$6,$7,'manual',NOW()) RETURNING *`,
      [req.params.id, req.user!.tenantId, conv.lead_id ?? null, body, wamid, relPath, msgStatus],
    );

    await query(
      `UPDATE conversations SET last_message=$1, last_message_at=NOW(), unread_count=0 WHERE id=$2`,
      [body, req.params.id],
    );
    emitToTenant(req.user!.tenantId!, 'conversation:updated', {
      id:              req.params.id,
      last_message:    body,
      last_message_at: new Date().toISOString(),
      unread_count:    0,
    });
    emitToTenant(req.user!.tenantId!, 'message:new', {
      ...msgRes.rows[0],
      media_url: `/api/conversations/media/${msgRes.rows[0].id}`,
    });

    res.status(201).json({
      ...msgRes.rows[0],
      media_url: `/api/conversations/media/${msgRes.rows[0].id}`,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/conversations/:id/interactive — send interactive message (buttons/list) via WABA
router.post('/:id/interactive', checkPermission('inbox:send'), async (req: AuthRequest, res: Response) => {
  const { type, body: bodyText, buttons, sections, header, footer, button_text } = req.body as {
    type: 'button' | 'list';
    body: string;
    buttons?: Array<{ id: string; title: string }>;
    sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
    header?: string;
    footer?: string;
    button_text?: string;
  };

  if (!bodyText?.trim()) { res.status(400).json({ error: 'body required' }); return; }
  if (type === 'button' && (!buttons?.length)) { res.status(400).json({ error: 'buttons required' }); return; }
  if (type === 'list' && (!sections?.length)) { res.status(400).json({ error: 'sections required' }); return; }

  try {
    const convRes = await query(
      `SELECT c.*, COALESCE(l.phone, c.phone) AS lead_phone
       FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id
       WHERE c.id=$1 AND c.tenant_id=$2`,
      [req.params.id, req.user!.tenantId],
    );
    if (!convRes.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    const conv = convRes.rows[0];

    if (conv.channel !== 'whatsapp') {
      res.status(400).json({ error: 'Interactive messages only supported for WABA' }); return;
    }

    const wabaRes = await query(
      'SELECT phone_number_id, access_token FROM waba_integrations WHERE tenant_id=$1 AND is_active=TRUE',
      [req.user!.tenantId],
    );
    if (!wabaRes.rows[0]) { res.status(400).json({ error: 'WABA not connected' }); return; }
    const { phone_number_id, access_token: encToken } = wabaRes.rows[0];
    const token = decrypt(encToken);

    const waResp = await sendWAInteractive(
      phone_number_id, token, conv.lead_phone,
      type, bodyText.trim(), buttons, sections, header, footer, button_text,
    );

    const wamid = waResp?.messages?.[0]?.id ?? null;
    if (waResp?.error) {
      res.status(400).json({ error: `WhatsApp: ${waResp.error.message}` }); return;
    }

    // Build display body
    const displayBody = type === 'button'
      ? `${bodyText}\n[Buttons: ${buttons!.map((b) => b.title).join(', ')}]`
      : `${bodyText}\n[List: ${sections!.flatMap((s) => s.rows.map((r) => r.title)).join(', ')}]`;

    const msgRes = await query(
      `INSERT INTO messages (conversation_id, tenant_id, lead_id, sender, body, is_note, wamid, status, sent_by, created_at)
       VALUES ($1,$2,$3,'agent',$4,FALSE,$5,'sent','manual',NOW()) RETURNING *`,
      [req.params.id, req.user!.tenantId, conv.lead_id ?? null, displayBody, wamid],
    );

    await query(
      `UPDATE conversations SET last_message=$1, last_message_at=NOW(), unread_count=0 WHERE id=$2`,
      [bodyText.trim(), req.params.id],
    );

    emitToTenant(req.user!.tenantId!, 'message:new', msgRes.rows[0]);
    res.status(201).json(msgRes.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/conversations/:id/typing — sends WA typing presence update
router.post('/:id/typing', checkPermission('inbox:send'), async (req: AuthRequest, res: Response) => {
  try {
    const convRes = await query(
      `SELECT c.channel, COALESCE(l.phone, c.phone) AS lead_phone
       FROM conversations c
       LEFT JOIN leads l ON l.id = c.lead_id
       WHERE c.id=$1 AND c.tenant_id=$2`,
      [req.params.id, req.user!.tenantId],
    );
    if (!convRes.rows[0]) { res.json({ success: false }); return; }
    const { channel, lead_phone } = convRes.rows[0];

    if (channel === 'personal_wa' && lead_phone) {
      const sock = getSession(req.user!.tenantId!);
      if (sock) {
        const jid = toJID(lead_phone);
        sock.sendPresenceUpdate('composing', jid).catch(() => null);
        setTimeout(() => sock.sendPresenceUpdate('paused', jid).catch(() => null), 3000);
      }
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/conversations/:id/assign
router.patch('/:id/assign', checkAnyPermission('inbox:assign','inbox:send'), async (req: AuthRequest, res: Response) => {
  const { assigned_to } = req.body as { assigned_to?: string | null };
  try {
    const result = await query(
      'UPDATE conversations SET assigned_to=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *',
      [assigned_to ?? null, req.params.id, req.user!.tenantId],
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    const full = await query(
      `SELECT c.*,
              COALESCE(l.name, '+' || c.phone, 'Unknown') AS lead_name,
              COALESCE(l.phone, '+' || c.phone)           AS lead_phone,
              u.name AS assigned_name
       FROM conversations c
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN users u ON u.id = c.assigned_to
       WHERE c.id=$1 AND c.tenant_id=$2`,
      [req.params.id, req.user!.tenantId],
    );
    const payload = full.rows[0] ?? result.rows[0];
    emitToTenant(req.user!.tenantId!, 'conversation:updated', payload);
    res.json(payload);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/conversations/:id/status
router.patch('/:id/status', checkPermission('inbox:send'), async (req: AuthRequest, res: Response) => {
  const { status } = req.body as { status?: string };
  if (!status) { res.status(400).json({ error: 'status required' }); return; }
  try {
    const result = await query(
      'UPDATE conversations SET status=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *',
      [status, req.params.id, req.user!.tenantId],
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    const full = await query(
      `SELECT c.*,
              COALESCE(l.name, '+' || c.phone, 'Unknown') AS lead_name,
              COALESCE(l.phone, '+' || c.phone)           AS lead_phone,
              u.name AS assigned_name
       FROM conversations c
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN users u ON u.id = c.assigned_to
       WHERE c.id=$1 AND c.tenant_id=$2`,
      [req.params.id, req.user!.tenantId],
    );
    const payload = full.rows[0] ?? result.rows[0];
    emitToTenant(req.user!.tenantId!, 'conversation:updated', payload);
    res.json(payload);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/conversations/:id/read — mark as read + send blue-tick receipts back to WA
router.patch('/:id/read', checkPermission('inbox:send'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user!.tenantId!;
    await query(
      'UPDATE conversations SET unread_count=0 WHERE id=$1 AND tenant_id=$2',
      [req.params.id, tenantId],
    );

    // Determine conversation channel
    const convRes = await query(
      'SELECT channel FROM conversations WHERE id=$1 AND tenant_id=$2',
      [req.params.id, tenantId],
    );
    const channel = convRes.rows[0]?.channel;

    // Get unread customer messages
    const unread = await query(
      `SELECT wamid, remote_jid FROM messages
       WHERE conversation_id=$1 AND tenant_id=$2 AND sender='customer' AND status='delivered'
         AND wamid IS NOT NULL`,
      [req.params.id, tenantId],
    );

    if (unread.rows.length > 0) {
      if (channel === 'whatsapp') {
        // WABA: send read receipts via Cloud API
        const wabaRes = await query(
          'SELECT phone_number_id, access_token FROM waba_integrations WHERE tenant_id=$1 AND is_active=TRUE LIMIT 1',
          [tenantId],
        );
        if (wabaRes.rows[0]) {
          const { phone_number_id, access_token: encToken } = wabaRes.rows[0];
          const waToken = decrypt(encToken);
          for (const row of unread.rows) {
            sendWARequest(phone_number_id, waToken, {
              messaging_product: 'whatsapp',
              status: 'read',
              message_id: row.wamid,
            }).catch(() => null);
          }
        }
      } else if (channel === 'personal_wa') {
        // Personal WA: send read receipts via Baileys
        const sock = getSession(tenantId);
        if (sock) {
          const withJid = unread.rows.filter((r: any) => r.remote_jid);
          if (withJid.length > 0) {
            const keys = withJid.map((r: any) => ({
              remoteJid: r.remote_jid,
              id: r.wamid,
              fromMe: false,
            }));
            sock.readMessages(keys).catch(() => null);
          }
        }
      }

      // Mark messages as read in DB
      const wamids = unread.rows.map((r: any) => r.wamid);
      await query(
        `UPDATE messages SET status='read' WHERE wamid = ANY($1) AND tenant_id=$2`,
        [wamids, tenantId],
      ).catch(() => null);
    }

    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/conversations/broadcast-leads — filtered leads for broadcast
router.get('/broadcast-leads', checkPermission('inbox:send'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { pipeline_id, stage_id, tag_id, group_id, search, from_date, to_date } = req.query as Record<string, string>;

  try {
    let sql = `SELECT DISTINCT l.id, l.name, l.phone, l.email, l.created_at,
               p.name AS pipeline_name, ps.name AS stage_name
               FROM leads l
               LEFT JOIN pipelines p ON p.id = l.pipeline_id
               LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id`;
    const params: any[] = [tenantId];
    let paramIdx = 2;

    if (tag_id) {
      sql += ` JOIN lead_tags lt ON lt.lead_id = l.id AND lt.tag_id = $${paramIdx}::uuid`;
      params.push(tag_id);
      paramIdx++;
    }

    if (group_id) {
      sql += ` JOIN contact_group_members cgm ON cgm.lead_id = l.id AND cgm.group_id = $${paramIdx}::uuid`;
      params.push(group_id);
      paramIdx++;
    }

    sql += ` WHERE l.tenant_id = $1 AND l.is_deleted = FALSE AND l.phone IS NOT NULL AND l.phone <> ''`;

    if (pipeline_id) {
      sql += ` AND l.pipeline_id = $${paramIdx}::uuid`;
      params.push(pipeline_id);
      paramIdx++;
    }

    if (stage_id) {
      sql += ` AND l.stage_id = $${paramIdx}::uuid`;
      params.push(stage_id);
      paramIdx++;
    }

    if (search?.trim()) {
      sql += ` AND (l.name ILIKE $${paramIdx} OR l.phone ILIKE $${paramIdx} OR l.email ILIKE $${paramIdx})`;
      params.push(`%${search.trim()}%`);
      paramIdx++;
    }

    if (from_date) {
      sql += ` AND l.created_at >= $${paramIdx}::date`;
      params.push(from_date);
      paramIdx++;
    }

    if (to_date) {
      sql += ` AND l.created_at < ($${paramIdx}::date + INTERVAL '1 day')`;
      params.push(to_date);
      paramIdx++;
    }

    sql += ` ORDER BY l.created_at DESC LIMIT 2000`;

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/conversations/broadcasts — list all broadcasts for tenant
router.get('/broadcasts', checkPermission('inbox:send'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { search } = req.query as Record<string, string>;
  try {
    let sql = `SELECT b.id, b.name, b.template_name, b.template_meta_name, b.total_leads,
               b.sent, b.failed, b.skipped, b.delivered, b.read_count, b.status,
               b.created_at, b.completed_at, u.name AS created_by_name
               FROM broadcasts b
               LEFT JOIN users u ON u.id = b.created_by
               WHERE b.tenant_id = $1`;
    const params: any[] = [tenantId];
    if (search?.trim()) {
      sql += ` AND b.name ILIKE $2`;
      params.push(`%${search.trim()}%`);
    }
    sql += ` ORDER BY b.created_at DESC LIMIT 200`;
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/conversations/broadcasts/:id — broadcast detail with delivery stats
router.get('/broadcasts/:id', checkPermission('inbox:send'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { id } = req.params;
  try {
    const bRes = await query(
      `SELECT b.*, u.name AS created_by_name FROM broadcasts b
       LEFT JOIN users u ON u.id = b.created_by
       WHERE b.id = $1::uuid AND b.tenant_id = $2`,
      [id, tenantId],
    );
    if (!bRes.rows[0]) { res.status(404).json({ error: 'Broadcast not found' }); return; }
    const broadcast = bRes.rows[0];

    // Get per-status message counts
    const statsRes = await query(
      `SELECT status, COUNT(*)::int AS count FROM messages
       WHERE broadcast_id = $1::uuid AND tenant_id = $2
       GROUP BY status`,
      [id, tenantId],
    );
    const statusCounts: Record<string, number> = {};
    for (const r of statsRes.rows) statusCounts[r.status] = r.count;

    // Get failure breakdown by error_reason
    const failRes = await query(
      `SELECT COALESCE(error_reason, 'Unknown error') AS reason, COUNT(*)::int AS count
       FROM messages
       WHERE broadcast_id = $1::uuid AND tenant_id = $2 AND status = 'failed'
       GROUP BY error_reason ORDER BY count DESC`,
      [id, tenantId],
    );

    res.json({
      ...broadcast,
      delivery_stats: statusCounts,
      failure_breakdown: failRes.rows,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/conversations/waba-single-send — send a WABA template to a single phone number
router.post('/waba-single-send', checkPermission('inbox:send'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const { phone, template_id, lead_id } = req.body as {
    phone: string; template_id: string; lead_id?: string;
  };
  if (!phone?.trim()) { res.status(400).json({ error: 'phone is required' }); return; }
  if (!template_id) { res.status(400).json({ error: 'template_id is required' }); return; }

  try {
    const wabaRes = await query(
      'SELECT phone_number_id, access_token FROM waba_integrations WHERE tenant_id=$1::uuid AND is_active=TRUE LIMIT 1',
      [tenantId],
    );
    if (!wabaRes.rows[0]) { res.status(400).json({ error: 'WABA not connected' }); return; }
    const { phone_number_id, access_token: encToken } = wabaRes.rows[0];
    const token = decrypt(encToken);

    const tplRes = await query(
      'SELECT meta_name, language, body, header, variables, meta_components FROM templates WHERE id=$1::uuid AND tenant_id=$2::uuid',
      [template_id, tenantId],
    );
    const tpl = tplRes.rows[0];
    if (!tpl?.meta_name) { res.status(400).json({ error: 'Template not found or not synced to Meta' }); return; }

    // Fetch lead info for variable interpolation
    let leadCtx: { name?: string | null; phone?: string | null; email?: string | null } = { phone: phone.trim() };
    if (lead_id) {
      const lr = await query('SELECT name, phone, email FROM leads WHERE id=$1::uuid AND tenant_id=$2::uuid', [lead_id, tenantId]);
      if (lr.rows[0]) leadCtx = lr.rows[0];
    } else {
      const cleanPhone = phone.trim().replace(/\D/g, '');
      const lr = await query(
        `SELECT name, phone, email FROM leads WHERE tenant_id=$1::uuid AND is_deleted=FALSE
         AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE '%' || RIGHT($2, 10) LIMIT 1`,
        [tenantId, cleanPhone],
      );
      if (lr.rows[0]) leadCtx = lr.rows[0];
    }

    // Build components using saved var_mapping (handles body, header, and button URL variables)
    const autoComponents = buildComponentsFromMapping(tpl.body ?? '', tpl.variables, leadCtx, tpl.header, tpl.meta_components);

    const waResp = await sendWATemplate(phone_number_id, token, phone.trim(), tpl.meta_name, tpl.language ?? 'en', autoComponents);
    if (waResp?.error) {
      console.error('[WABA single send] error:', waResp.error);
      res.status(400).json({ error: `WhatsApp error: ${waResp.error.message}` });
      return;
    }

    const wamid = waResp?.messages?.[0]?.id ?? null;
    const messageBody = interpolateVars(tpl.body ?? tpl.meta_name, leadCtx);

    // Find or create conversation + store message
    let leadId = lead_id ?? null;
    const cleanPhone = phone.trim().replace(/\D/g, '');
    if (!leadId) {
      const leadRes = await query(
        `SELECT id FROM leads WHERE tenant_id=$1::uuid AND is_deleted=FALSE
         AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE '%' || RIGHT($2, 10) LIMIT 1`,
        [tenantId, cleanPhone],
      );
      leadId = leadRes.rows[0]?.id ?? null;
    }

    let convId: string | null = null;
    if (leadId) {
      const convRes = await query(
        `SELECT id FROM conversations WHERE tenant_id=$1::uuid AND channel='whatsapp' AND lead_id=$2::uuid
         ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
        [tenantId, leadId],
      );
      if (convRes.rows[0]) {
        convId = convRes.rows[0].id;
      } else {
        const newConv = await query(
          `INSERT INTO conversations (tenant_id, lead_id, channel, status, unread_count, last_message_at, phone)
           VALUES ($1::uuid, $2::uuid, 'whatsapp', 'open', 0, NOW(), $3) RETURNING id`,
          [tenantId, leadId, phone.trim()],
        );
        convId = newConv.rows[0].id;
      }
    } else {
      const convRes = await query(
        `SELECT id FROM conversations WHERE tenant_id=$1::uuid AND channel='whatsapp' AND lead_id IS NULL
         AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE '%' || RIGHT($2, 10)
         ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
        [tenantId, cleanPhone],
      );
      if (convRes.rows[0]) {
        convId = convRes.rows[0].id;
      } else {
        const newConv = await query(
          `INSERT INTO conversations (tenant_id, lead_id, channel, status, unread_count, last_message_at, phone)
           VALUES ($1::uuid, NULL, 'whatsapp', 'open', 0, NOW(), $2) RETURNING id`,
          [tenantId, phone.trim()],
        );
        convId = newConv.rows[0].id;
      }
    }

    // Insert message
    if (convId) {
      await query(
        `INSERT INTO messages (conversation_id, tenant_id, lead_id, sender, body, wamid, status, sent_by, created_at)
         VALUES ($1, $2::uuid, $3, 'agent', $4, $5, 'sent', 'manual', NOW())`,
        [convId, tenantId, leadId, messageBody, wamid],
      );
      await query(
        `UPDATE conversations SET last_message=$1, last_message_at=NOW() WHERE id=$2`,
        [messageBody.slice(0, 200), convId],
      );
    }

    res.json({ success: true, wamid, conversation_id: convId });
  } catch (err: any) {
    console.error('[WABA single send]', err);
    res.status(500).json({ error: err?.message ?? 'Server error' });
  }
});

// POST /api/conversations/broadcast — send a WABA template to multiple leads
router.post('/broadcast', checkPermission('inbox:send'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const { template_id, lead_ids, template_params, filters, name: customName } = req.body as {
    template_id: string;
    lead_ids: string[];
    template_params?: Record<string, Array<{ type: string; text: string }>>;
    filters?: Record<string, any>;
    name?: string;
  };

  if (!template_id || !lead_ids?.length) {
    res.status(400).json({ error: 'template_id and lead_ids are required' }); return;
  }
  if (lead_ids.length > 500) {
    res.status(400).json({ error: 'Maximum 500 recipients per broadcast' }); return;
  }

  try {
    // Get WABA credentials
    const wabaRes = await query(
      'SELECT phone_number_id, access_token FROM waba_integrations WHERE tenant_id=$1 AND is_active=TRUE LIMIT 1',
      [tenantId],
    );
    if (!wabaRes.rows[0]) { res.status(400).json({ error: 'WABA not connected' }); return; }
    const { phone_number_id, access_token: encToken } = wabaRes.rows[0];
    const waToken = decrypt(encToken);

    // Get template
    const tplRes = await query(
      `SELECT id, name, meta_name, language, body, header, footer, variables, meta_components FROM templates WHERE id=$1::uuid AND tenant_id=$2 AND template_type='waba'`,
      [template_id, tenantId],
    );
    const tpl = tplRes.rows[0];
    if (!tpl?.meta_name) { res.status(400).json({ error: 'Template not found or not synced with Meta' }); return; }

    // Create broadcast record
    const now = new Date();
    const broadcastName = customName?.trim() || `${tpl.meta_name}-${now.toISOString().slice(0,10)}-${now.toTimeString().slice(0,8).replace(/:/g,'-')}`;
    const bcRes = await query(
      `INSERT INTO broadcasts (tenant_id, name, template_id, template_name, template_meta_name, template_body, template_header, template_footer, total_leads, status, filters, created_by)
       VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,'sending',$10::jsonb,$11)
       RETURNING id`,
      [tenantId, broadcastName, template_id, tpl.name, tpl.meta_name, tpl.body, tpl.header ?? null, tpl.footer ?? null, lead_ids.length, JSON.stringify(filters ?? {}), userId],
    );
    const broadcastId = bcRes.rows[0].id;

    // Fetch leads (include email for variable interpolation)
    const leadsRes = await query(
      `SELECT id, name, phone, email FROM leads WHERE id = ANY($1::uuid[]) AND tenant_id=$2 AND is_deleted=FALSE`,
      [lead_ids, tenantId],
    );

    let sent = 0, failed = 0, skipped = 0;
    const errors: string[] = [];

    // Build template components from explicit params (if any)
    const explicitComponents: Array<{ type: string; parameters: Array<{ type: string; text: string }> }> = [];
    if (template_params) {
      for (const [compType, params] of Object.entries(template_params)) {
        if (Array.isArray(params) && params.length > 0) {
          explicitComponents.push({ type: compType, parameters: params });
        }
      }
    }
    const hasExplicitParams = explicitComponents.length > 0;

    for (const lead of leadsRes.rows) {
      if (!lead.phone) { skipped++; continue; }
      try {
        const leadCtx = { name: lead.name, phone: lead.phone, email: lead.email };
        // Use explicit params if provided, else build from saved var_mapping per-lead
        const resolvedComps = hasExplicitParams
          ? interpolateComponents(explicitComponents as any, leadCtx)
          : buildComponentsFromMapping(tpl.body ?? '', tpl.variables, leadCtx, tpl.header, tpl.meta_components);
        const payload: any = {
          messaging_product: 'whatsapp',
          to: lead.phone.replace(/\D/g, ''),
          type: 'template',
          template: {
            name: tpl.meta_name,
            language: { code: tpl.language ?? 'en' },
          },
        };
        const withParams = resolvedComps.filter((c) => c.parameters && c.parameters.length > 0);
        if (withParams.length > 0) {
          payload.template.components = withParams;
        }
        const resp = await sendWARequest(phone_number_id, waToken, payload);
        if (resp?.error) {
          failed++;
          errors.push(`${lead.name}: ${resp.error.message}`);
        } else {
          sent++;
          // Log to conversation with broadcast_id
          const wamid = resp?.messages?.[0]?.id ?? null;
          const msgBody = `[Template: ${tpl.meta_name}] ${interpolateVars(tpl.body ?? '', leadCtx)}`;
          let convRes2 = await query(
            `SELECT id FROM conversations WHERE lead_id=$1 AND channel='whatsapp' AND status<>'resolved' LIMIT 1`,
            [lead.id],
          );
          let convId: string;
          if (convRes2.rows[0]) {
            convId = convRes2.rows[0].id;
          } else {
            const nc = await query(
              `INSERT INTO conversations (tenant_id, lead_id, channel, status, unread_count, last_message, last_message_at)
               VALUES ($1,$2,'whatsapp','open',0,$3,NOW()) RETURNING id`,
              [tenantId, lead.id, msgBody],
            );
            convId = nc.rows[0].id;
          }
          await query(
            `INSERT INTO messages (conversation_id, tenant_id, lead_id, sender, body, is_note, wamid, status, sent_by, broadcast_id, created_at)
             VALUES ($1,$2,$3,'agent',$4,FALSE,$5,'sent','broadcast',$6::uuid,NOW())`,
            [convId, tenantId, lead.id, msgBody, wamid, broadcastId],
          );
          await query(
            `UPDATE conversations SET last_message=$1, last_message_at=NOW() WHERE id=$2`,
            [msgBody, convId],
          );
        }
        // Small delay to avoid rate limiting
        if (leadsRes.rows.length > 10) await new Promise((r) => setTimeout(r, 100));
      } catch (err: any) {
        failed++;
        errors.push(`${lead.name}: ${err.message}`);
      }
    }

    // Update broadcast record with final counts
    await query(
      `UPDATE broadcasts SET sent=$1, failed=$2, skipped=$3, status='completed', completed_at=NOW(),
       error_details=$4::jsonb WHERE id=$5::uuid`,
      [sent, failed, skipped, JSON.stringify(errors.slice(0, 50)), broadcastId],
    );

    // Emit to frontend
    if (tenantId) emitToTenant(tenantId, 'broadcast:completed', { id: broadcastId, name: broadcastName, sent, failed, skipped, total: leadsRes.rows.length });

    res.json({ id: broadcastId, sent, failed, skipped, total: leadsRes.rows.length, errors: errors.slice(0, 20) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

export default router;
