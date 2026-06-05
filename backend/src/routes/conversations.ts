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

function sendWAMessage(phoneNumberId: string, token: string, toPhone: string, text: string): Promise<any> {
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
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
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
  const { body, is_note } = req.body as { body?: string; is_note?: boolean };
  if (!body?.trim()) { res.status(400).json({ error: 'body required' }); return; }
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

    let wamid: string | null = null;

    // Send via WABA
    if (!is_note && conv.channel === 'whatsapp' && conv.lead_phone) {
      try {
        const wabaRes = await query(
          'SELECT phone_number_id, access_token FROM waba_integrations WHERE tenant_id=$1 AND is_active=TRUE',
          [req.user!.tenantId],
        );
        if (wabaRes.rows[0]) {
          const { phone_number_id, access_token: encToken } = wabaRes.rows[0];
          const token = decrypt(encToken);
          const waResp = await sendWAMessage(phone_number_id, token, conv.lead_phone, body.trim());
          wamid = waResp?.messages?.[0]?.id ?? null;
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
          wamid = await sendText(req.user!.tenantId!, targetJid, body.trim());
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
      [req.params.id, req.user!.tenantId, conv.lead_id ?? null, body.trim(), is_note ?? false, wamid, msgStatus],
    );

    if (!is_note) {
      await query(
        `UPDATE conversations SET last_message=$1, last_message_at=NOW(), unread_count=0 WHERE id=$2`,
        [body.trim(), req.params.id],
      );
      // Emit conversation:updated so all connected clients update the preview and re-sort
      emitToTenant(req.user!.tenantId!, 'conversation:updated', {
        id:              req.params.id,
        last_message:    body.trim(),
        last_message_at: new Date().toISOString(),
        unread_count:    0,
      });
    }

    emitToTenant(req.user!.tenantId!, 'message:new', msgRes.rows[0]);
    res.status(201).json(msgRes.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/conversations/:id/media — send a media file via Personal WA
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

    if (conv.channel !== 'personal_wa') {
      res.status(400).json({ error: 'Media send only supported for Personal WhatsApp' }); return;
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

    // Send via Baileys — resolve @lid JID the same way as text send
    let wamid: string | null = null;
    let deliveryFailed = false;
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
    await query(
      'UPDATE conversations SET unread_count=0 WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.user!.tenantId],
    );

    // Send read receipts back to WhatsApp Personal (blue ticks)
    const sock = getSession(req.user!.tenantId!);
    if (sock) {
      const unread = await query(
        `SELECT wamid, remote_jid FROM messages
         WHERE conversation_id=$1 AND tenant_id=$2 AND sender='customer' AND status='delivered'
           AND wamid IS NOT NULL AND remote_jid IS NOT NULL`,
        [req.params.id, req.user!.tenantId],
      );
      if (unread.rows.length > 0) {
        const keys = unread.rows.map((r: any) => ({
          remoteJid: r.remote_jid,
          id:        r.wamid,
          fromMe:    false,
        }));
        sock.readMessages(keys).catch(() => null);

        const wamids = unread.rows.map((r: any) => r.wamid);
        await query(
          `UPDATE messages SET status='read' WHERE wamid = ANY($1) AND tenant_id=$2`,
          [wamids, req.user!.tenantId],
        ).catch(() => null);
      }
    }

    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

export default router;
