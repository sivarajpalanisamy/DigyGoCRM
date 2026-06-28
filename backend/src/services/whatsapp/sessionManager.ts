import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import { query } from '../../db';
import { emitToTenant } from '../../socket';
import { handleInboundMessage } from './messageHandler';

const WA_SESSIONS_DIR = process.env.WA_SESSIONS_DIR
  || path.join(process.cwd(), 'wa_sessions');

const WA_MEDIA_DIR = process.env.WA_MEDIA_DIR
  || path.join(process.cwd(), 'wa_media');

// ── Session key helpers ─────────────────────────────────────────────────────
// Multi-session: all Maps are keyed by "tenantId::sessionId"
function skey(tenantId: string, sessionId: string): string {
  return `${tenantId}::${sessionId}`;
}

// Background queue for historical media downloads — drains at 1 item/sec to avoid overload
interface MediaQueueItem { tenantId: string; msg: any; msgId: string; }
const mediaDownloadQueue: MediaQueueItem[] = [];
let mediaQueueRunning = false;
function drainMediaQueue() {
  if (mediaQueueRunning) return;
  mediaQueueRunning = true;
  const tick = () => {
    const item = mediaDownloadQueue.shift();
    if (!item) { mediaQueueRunning = false; return; }
    downloadAndStoreMedia(item.tenantId, item.msg, item.msgId)
      .catch(() => null)
      .finally(() => setTimeout(tick, 1000));
  };
  tick();
}

// In-memory state — source of truth (more reliable than DB after restarts)
// Keys are "tenantId::sessionId"
const sessions          = new Map<string, ReturnType<typeof makeWASocket>>();
const connectedSessions = new Set<string>();
const pendingQRs        = new Map<string, string>();
const retryCount        = new Map<string, number>();
const intentionallyStopped = new Set<string>();

// WA contacts cache (phone book contacts from the connected device)
const waContactsCache = new Map<string, { id: string; name: string; phone: string }[]>();

// LID -> real phone mapping (multi-device WhatsApp sends @lid JIDs instead of phone JIDs)
const lidToPhone = new Map<string, string>(); // key: "86256281202697" -> value: "918072256598"

/**
 * Persist a LID->phone mapping to DB and memory, then merge any LID-based
 * anonymous conversation into the real phone conversation.
 */
async function storeLidMapping(tenantId: string, lidDigits: string, phoneDigits: string): Promise<void> {
  lidToPhone.set(lidDigits, phoneDigits);
  await query(
    `INSERT INTO wa_lid_phone_map (tenant_id, lid_digits, phone_digits, updated_at)
     VALUES ($1::uuid, $2, $3, NOW())
     ON CONFLICT (tenant_id, lid_digits) DO UPDATE SET phone_digits=$3, updated_at=NOW()`,
    [tenantId, lidDigits, phoneDigits],
  ).catch(() => null);

  // Find any LID-based anonymous conversation (phone = lidDigits) and merge it
  try {
    const lidConv = await query(
      `SELECT id FROM conversations
       WHERE tenant_id=$1::uuid AND channel='personal_wa' AND lead_id IS NULL
         AND REGEXP_REPLACE(phone,'[^0-9]','','g') = $2
       LIMIT 1`,
      [tenantId, lidDigits],
    );
    if (lidConv.rows[0]) {
      const lidConvId = lidConv.rows[0].id;
      const realConv = await query(
        `SELECT id FROM conversations
         WHERE tenant_id=$1::uuid AND channel='personal_wa'
           AND REGEXP_REPLACE(COALESCE(phone, (SELECT phone FROM leads WHERE id=lead_id)), '[^0-9]','','g')
               LIKE '%' || RIGHT($2, 10)
           AND id != $3
         ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
        [tenantId, phoneDigits, lidConvId],
      );
      if (realConv.rows[0]) {
        const realConvId = realConv.rows[0].id;
        await query(`UPDATE messages SET conversation_id=$1 WHERE conversation_id=$2`, [realConvId, lidConvId]);
        await query(
          `UPDATE conversations c
           SET last_message = m.body, last_message_at = m.created_at,
               unread_count = (SELECT COUNT(*) FROM messages WHERE conversation_id=$1 AND sender='customer')
           FROM (SELECT body, created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 1) m
           WHERE c.id = $1`,
          [realConvId],
        );
        await query(`DELETE FROM conversations WHERE id=$1`, [lidConvId]);
        console.log(`[WA] Merged LID conv ${lidConvId} -> real conv ${realConvId} (${phoneDigits})`);
        emitToTenant(tenantId, 'conversation:deleted', { id: lidConvId });
        emitToTenant(tenantId, 'conversation:updated', { id: realConvId });
      } else {
        await query(`UPDATE conversations SET phone=$1 WHERE id=$2`, [phoneDigits, lidConvId]);
        console.log(`[WA] Updated LID conv phone: ${lidDigits} -> ${phoneDigits}`);
        emitToTenant(tenantId, 'conversation:updated', { id: lidConvId, phone: `+${phoneDigits}` });
      }
    }
  } catch (e) {
    console.error('[WA] LID merge error:', e);
  }

  // Fix leads auto-created with LID digits as phone
  try {
    const lidLeads = await query(
      `UPDATE leads
       SET phone = '+' || $1,
           name  = CASE WHEN name = '+' || $2 THEN '+' || $1 ELSE name END,
           updated_at = NOW()
       WHERE tenant_id=$3::uuid AND is_deleted=FALSE
         AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = $2
       RETURNING id, name`,
      [phoneDigits, lidDigits, tenantId],
    );
    for (const lead of lidLeads.rows) {
      console.log(`[WA] Fixed LID lead ${lead.id}: phone ${lidDigits} -> ${phoneDigits}`);
      emitToTenant(tenantId, 'lead:updated', { id: lead.id, phone: `+${phoneDigits}`, name: lead.name });
      const conv = await query(
        `SELECT id FROM conversations
         WHERE tenant_id=$1::uuid AND lead_id=$2::uuid AND channel='personal_wa' LIMIT 1`,
        [tenantId, lead.id],
      );
      if (conv.rows[0]) {
        emitToTenant(tenantId, 'conversation:updated', { id: conv.rows[0].id, phone: `+${phoneDigits}` });
      }
    }
  } catch (e) {
    console.error('[WA] LID lead fix error:', e);
  }
}

/**
 * Query WA servers for LIDs of a batch of phone numbers.
 */
async function lookupLidForPhonesBatch(sock: any, phones: string[]): Promise<Map<string, string>> {
  const phoneToLid = new Map<string, string>();
  if (!phones.length) return phoneToLid;
  try {
    const findChild = (node: any, tag: string): any =>
      (Array.isArray(node?.content) ? node.content : []).find((n: any) => n.tag === tag);

    const usyncQuery = {
      protocols: [
        {
          name: 'contact',
          getQueryElement: () => ({ tag: 'contact', attrs: {} }),
          getUserElement: (u: any) => ({ tag: 'contact', attrs: {}, content: u.phone }),
        },
        {
          name: 'lid',
          getQueryElement: () => ({ tag: 'lid', attrs: {} }),
          getUserElement: (_u: any) => null,
        },
      ],
      users: phones.map(phone => ({ phone: `+${phone}` })),
      context: 'interactive',
      mode:    'query',
      parseUSyncQueryResult(rawResult: any) {
        if (rawResult?.attrs?.type !== 'result') return null;
        try {
          const usync = findChild(rawResult, 'usync');
          const list  = findChild(usync, 'list');
          const items: any[] = [];
          for (const uNode of (list?.content ?? [])) {
            if (!Array.isArray(uNode?.content)) continue;
            const phoneJid = uNode.attrs?.jid as string | undefined;
            const lidNode  = uNode.content.find((c: any) => c.tag === 'lid');
            const lidJid   = lidNode?.attrs?.val as string | undefined;
            if (phoneJid) items.push({ id: phoneJid, lid: lidJid ?? null });
          }
          return { list: items, sideList: [] };
        } catch { return null; }
      },
    };

    const queryResult = await sock.executeUSyncQuery(usyncQuery);
    for (const item of (queryResult?.list ?? [])) {
      if (item?.id && item?.lid) {
        const phone    = (item.id  as string).split('@')[0];
        const lidDigit = (item.lid as string).split('@')[0];
        if (phone && lidDigit) phoneToLid.set(phone, lidDigit);
      }
    }
  } catch (e: any) {
    console.error('[WA] LID batch lookup error:', e?.message ?? e);
  }
  return phoneToLid;
}

/**
 * Query WA servers for the LID of every known conversation phone in this tenant.
 */
async function resolveLidsForTenant(tenantId: string, sock: ReturnType<typeof makeWASocket>): Promise<void> {
  const rows = await query(
    `SELECT DISTINCT REGEXP_REPLACE(COALESCE(l.phone, c.phone), '[^0-9]', '', 'g') AS phone
     FROM conversations c
     LEFT JOIN leads l ON l.id = c.lead_id
     WHERE c.tenant_id=$1::uuid AND c.channel='personal_wa'
       AND COALESCE(l.phone, c.phone) IS NOT NULL
       AND LENGTH(REGEXP_REPLACE(COALESCE(l.phone, c.phone), '[^0-9]', '', 'g')) BETWEEN 10 AND 15
     LIMIT 50`,
    [tenantId],
  );

  const alreadyMappedPhones = new Set(lidToPhone.values());
  const phones = rows.rows
    .map(r => r.phone as string)
    .filter(p => p && !alreadyMappedPhones.has(p));

  const allMappings = await query(
    `SELECT lid_digits, phone_digits FROM wa_lid_phone_map WHERE tenant_id=$1::uuid`,
    [tenantId],
  );
  for (const { lid_digits, phone_digits } of allMappings.rows) {
    await storeLidMapping(tenantId, lid_digits, phone_digits);
  }

  try {
    const knownPhoneSet = new Set(allMappings.rows.map((r: any) => r.phone_digits as string));
    const unresolvedRes = await query(
      `SELECT DISTINCT REGEXP_REPLACE(COALESCE(c.phone, ''), '[^0-9]', '', 'g') AS digits
       FROM conversations c
       WHERE c.tenant_id=$1::uuid AND c.channel='personal_wa' AND c.lead_id IS NULL
         AND c.phone IS NOT NULL
         AND LENGTH(REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g')) >= 14`,
      [tenantId],
    );
    for (const row of unresolvedRes.rows) {
      const d = row.digits as string;
      if (d && !knownPhoneSet.has(d) && !lidToPhone.has(d)) {
        const lidJid = `${d}@lid`;
        console.log(`[WA] Requesting contact info for unresolved LID conversation: ${lidJid}`);
        sock.assertSessions([lidJid], true).catch(() => null);
        sock.presenceSubscribe(lidJid).catch(() => null);
      }
    }
  } catch { /* non-critical */ }

  if (!phones.length) {
    console.log(`[WA] LID cleanup done; no new phones to USync`);
    return;
  }
  console.log(`[WA] Resolving LIDs for ${phones.length} phone(s) via USync...`);

  const phoneToLid = await lookupLidForPhonesBatch(sock as any, phones);
  for (const [phone, lidDigits] of phoneToLid) {
    console.log(`[WA] USync resolved: ${phone} -> lid=${lidDigits}`);
    await storeLidMapping(tenantId, lidDigits, phone);
  }
  if (!phoneToLid.size) {
    console.log(`[WA] USync: no LID mappings found for ${phones.length} phone(s)`);
  }
}

const MAX_RETRIES = 5;

function sessionDir(tenantId: string, sessionId: string): string {
  return path.join(WA_SESSIONS_DIR, `${tenantId}_${sessionId}`);
}

// Legacy session dir (pre-multi-session) — used for migration/restore
function legacySessionDir(tenantId: string): string {
  return path.join(WA_SESSIONS_DIR, tenantId);
}

async function upsertSessionStatus(tenantId: string, sessionId: string, status: string, phoneNumber?: string | null) {
  await query(
    `INSERT INTO wa_personal_sessions (session_id, tenant_id, status, phone_number, connected_at, updated_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, NOW())
     ON CONFLICT (session_id) DO UPDATE
       SET status=$3, phone_number=COALESCE($4, wa_personal_sessions.phone_number),
           connected_at=CASE WHEN $3='connected' THEN NOW() ELSE wa_personal_sessions.connected_at END,
           updated_at=NOW()`,
    [sessionId, tenantId, status, phoneNumber ?? null, status === 'connected' ? new Date() : null],
  );
  emitToTenant(tenantId, 'wa:status', { sessionId, status, phone: phoneNumber ?? null });
}

/**
 * Downloads a Baileys media message and stores it to disk.
 */
async function downloadAndStoreMedia(tenantId: string, msg: any, msgId: string): Promise<void> {
  const m = msg.message;
  if (!m) return;

  const inner: any =
    m.ephemeralMessage?.message ??
    m.viewOnceMessage?.message ??
    m.viewOnceMessageV2?.message ??
    m.viewOnceMessageV2Extension?.message ??
    m.documentWithCaptionMessage?.message ??
    m.editedMessage?.message ??
    m;

  let mediaKey: string | null = null;
  let ext = 'bin';
  if      (inner.imageMessage)    { mediaKey = 'imageMessage';    ext = 'jpg'; }
  else if (inner.videoMessage)    { mediaKey = 'videoMessage';    ext = 'mp4'; }
  else if (inner.audioMessage)    {
    mediaKey = 'audioMessage';
    ext = inner.audioMessage.ptt ? 'ogg' : 'mp3';
  }
  else if (inner.documentMessage) {
    mediaKey = 'documentMessage';
    const fn = inner.documentMessage.fileName ?? '';
    ext = fn.includes('.') ? fn.split('.').pop()! : 'bin';
  }
  else if (inner.stickerMessage)  { mediaKey = 'stickerMessage';  ext = 'webp'; }

  if (!mediaKey) return;

  try {
    const buffer = await downloadMediaMessage(
      { message: { [mediaKey]: inner[mediaKey] }, key: msg.key } as any,
      'buffer',
      {},
    ) as Buffer;

    const mediaDir = path.join(WA_MEDIA_DIR, tenantId);
    fs.mkdirSync(mediaDir, { recursive: true });

    const filename = `${msgId}.${ext}`;
    const filePath = path.join(mediaDir, filename);
    fs.writeFileSync(filePath, buffer);

    const relPath = `wa_media/${tenantId}/${filename}`;
    await query(`UPDATE messages SET media_url=$1 WHERE id=$2`, [relPath, msgId]);

    emitToTenant(tenantId, 'message:updated', {
      id:        msgId,
      media_url: `/api/conversations/media/${msgId}`,
    });
  } catch (e) {
    console.error(`[WA Media] Download failed for msg ${msgId}:`, (e as Error)?.message ?? e);
  }
}

export async function startSession(tenantId: string, sessionId: string): Promise<void> {
  const key = skey(tenantId, sessionId);
  await stopSession(tenantId, sessionId, false);
  pendingQRs.delete(key);

  const authDir = sessionDir(tenantId, sessionId);
  fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  await upsertSessionStatus(tenantId, sessionId, 'connecting');

  console.log(`[WA] Starting session ${sessionId.slice(0, 8)} for tenant ${tenantId.slice(0, 8)}... auth dir has ${fs.readdirSync(authDir).length} files`);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['Hawcus CRM', 'Chrome', '1.0'],
    connectTimeoutMs: 30_000,
    logger: {
      level: 'warn',
      trace: () => {}, debug: () => {}, info: () => {},
      warn:  (msg: any) => console.warn('[Baileys]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
      error: (msg: any) => console.error('[Baileys]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
      fatal: (msg: any) => console.error('[Baileys FATAL]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
      child: () => ({ level: 'warn', trace: () => {}, debug: () => {}, info: () => {},
        warn: (m: any) => console.warn('[Baileys]', m), error: (m: any) => console.error('[Baileys]', m),
        fatal: (m: any) => console.error('[Baileys]', m), child: () => ({}) as any }),
    } as any,
  });

  sessions.set(key, sock);

  // ── Connection lifecycle ──────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(`[WA] QR generated for session ${sessionId.slice(0, 8)} tenant ${tenantId.slice(0, 8)}`);
      try {
        const qrBase64 = await qrcode.toDataURL(qr);
        pendingQRs.set(key, qrBase64);
        emitToTenant(tenantId, 'wa:qr', { sessionId, qr: qrBase64 });
      } catch { /* ignore */ }
    }

    if (connection === 'open') {
      retryCount.delete(key);
      connectedSessions.add(key);
      pendingQRs.delete(key);
      const jid   = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
      const phone = jid ? jid.split('@')[0] : null;
      console.log(`[WA] Connected session ${sessionId.slice(0, 8)} for tenant ${tenantId.slice(0, 8)}: ${phone ?? 'unknown'}`);
      await upsertSessionStatus(tenantId, sessionId, 'connected', phone ? `+${phone}` : null);

      // Record session start in history
      if (phone) {
        await query(
          `INSERT INTO wa_session_history (tenant_id, session_id, phone, connected_at)
           VALUES ($1::uuid, $2::uuid, $3, NOW())`,
          [tenantId, sessionId, phone],
        ).catch(() => null);
      }

      // Pre-load persisted LID -> phone mappings
      try {
        const lidRows = await query(
          `SELECT lid_digits, phone_digits FROM wa_lid_phone_map WHERE tenant_id=$1::uuid`,
          [tenantId],
        );
        for (const row of lidRows.rows) {
          lidToPhone.set(row.lid_digits, row.phone_digits);
        }
        if (lidRows.rows.length > 0) {
          console.log(`[WA] Pre-loaded ${lidRows.rows.length} LID mappings from DB for tenant ${tenantId.slice(0, 8)}`);
        }
      } catch { /* non-critical */ }

      setTimeout(() => resolveLidsForTenant(tenantId, sock).catch(() => null), 5_000);

      // Wait 60s for history sync, then backfill phones on anonymous conversations
      setTimeout(async () => {
        try {
          const upd = await query(
            `UPDATE conversations c
             SET phone = SPLIT_PART(m.remote_jid, '@', 1)
             FROM (
               SELECT DISTINCT ON (conversation_id) conversation_id, remote_jid
               FROM messages
               WHERE remote_jid IS NOT NULL AND remote_jid LIKE '%@s.whatsapp.net'
               ORDER BY conversation_id, created_at ASC
             ) m
             WHERE c.id = m.conversation_id
               AND c.tenant_id = $1::uuid
               AND c.lead_id IS NULL
               AND c.channel = 'personal_wa'
               AND (c.phone IS NULL OR c.phone = '')`,
            [tenantId],
          );
          const count = upd.rowCount ?? 0;
          if (count > 0) {
            console.log(`[WA] Post-connect backfill: fixed ${count} anonymous conversation(s) with phone`);
            const fixed = await query(
              `SELECT c.id, '+' || c.phone AS lead_phone, c.last_message, c.last_message_at,
                      c.status, c.unread_count, c.assigned_to
               FROM conversations c
               WHERE c.tenant_id = $1::uuid AND c.channel='personal_wa'
                 AND c.lead_id IS NULL AND c.phone IS NOT NULL AND c.phone != ''`,
              [tenantId],
            );
            for (const conv of fixed.rows) {
              emitToTenant(tenantId, 'conversation:updated', {
                ...conv,
                lead_name: conv.lead_phone,
              });
            }
          }
        } catch (e) {
          console.error('[WA] Post-connect backfill error:', e);
        }
      }, 60_000);
    }

    if (connection === 'close') {
      connectedSessions.delete(key);
      const code      = (lastDisconnect?.error as any)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut || code === 401;
      console.log(`[WA] Connection closed for session ${sessionId.slice(0, 8)} tenant ${tenantId.slice(0, 8)}: code=${code ?? 'none'}, loggedOut=${loggedOut}`);

      // Record session end in history
      const sessionPhoneOnDisconnect = sock.user?.id ? jidNormalizedUser(sock.user.id).split('@')[0] : null;
      if (sessionPhoneOnDisconnect) {
        const reason = loggedOut ? 'logged_out' : (intentionallyStopped.has(key) ? 'stopped' : 'error');
        await query(
          `UPDATE wa_session_history SET disconnected_at=NOW(), disconnect_reason=$1
           WHERE tenant_id=$2::uuid AND session_id=$3::uuid AND phone=$4 AND disconnected_at IS NULL`,
          [reason, tenantId, sessionId, sessionPhoneOnDisconnect],
        ).catch(() => null);
      }

      if (intentionallyStopped.has(key)) return;

      if (loggedOut) {
        retryCount.delete(key);
        sessions.delete(key);
        try { fs.rmSync(sessionDir(tenantId, sessionId), { recursive: true, force: true }); } catch {}
        await upsertSessionStatus(tenantId, sessionId, 'disconnected');
      } else {
        const current = (retryCount.get(key) ?? 0) + 1;
        if (current >= MAX_RETRIES) {
          retryCount.delete(key);
          sessions.delete(key);
          try { fs.rmSync(sessionDir(tenantId, sessionId), { recursive: true, force: true }); } catch {}
          await upsertSessionStatus(tenantId, sessionId, 'disconnected');
        } else {
          retryCount.set(key, current);
          await upsertSessionStatus(tenantId, sessionId, 'connecting');
          setTimeout(() => startSession(tenantId, sessionId).catch(() => null), 3000);
        }
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ── Incoming / history messages ───────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    const historical = type === 'append';
    if (type !== 'notify' && type !== 'append') return;
    const sessionPhone = sock.user?.id ? jidNormalizedUser(sock.user.id).split('@')[0] : null;

    console.log(`[WA] messages.upsert type=${type} count=${messages.length} session=${sessionPhone}`);
    for (let msg of messages) {
      const remoteJid = msg.key?.remoteJid ?? '';
      if (remoteJid.endsWith('@lid')) {
        const lidDigits = remoteJid.split('@')[0];
        let realPhone = lidToPhone.get(lidDigits);

        if (!realPhone) {
          try {
            const dbRow = await query(
              `SELECT phone_digits FROM wa_lid_phone_map WHERE tenant_id=$1::uuid AND lid_digits=$2`,
              [tenantId, lidDigits],
            );
            if (dbRow.rows[0]?.phone_digits) {
              realPhone = dbRow.rows[0].phone_digits;
              lidToPhone.set(lidDigits, realPhone!);
              console.log(`[WA] LID resolved from DB: ${remoteJid} -> ${realPhone}@s.whatsapp.net`);
            }
          } catch { /* non-critical */ }
        }

        if (realPhone) {
          msg = { ...msg, key: { ...msg.key, remoteJid: `${realPhone}@s.whatsapp.net` } };
          console.log(`[WA] LID resolved: ${remoteJid} -> ${realPhone}@s.whatsapp.net`);
        } else {
          console.log(`[WA] LID not resolved: ${remoteJid} -- requesting contact info from WA`);
          sock.assertSessions([remoteJid], true).catch(() => null);
          sock.presenceSubscribe(remoteJid).catch(() => null);
        }
      }
      console.log(`[WA] msg remoteJid=${msg.key?.remoteJid} fromMe=${msg.key?.fromMe} hasMsg=${!!msg.message} keys=${msg.message ? Object.keys(msg.message).join(',') : 'none'}`);
      const result = await handleInboundMessage(tenantId, msg, { historical, waPhone: sessionPhone }).catch((e) => {
        console.error('[WA] handleInboundMessage error:', e?.message ?? e);
        return null;
      });
      if (result?.hasMedia) {
        if (historical) {
          mediaDownloadQueue.push({ tenantId, msg, msgId: result.msgId });
          drainMediaQueue();
        } else {
          downloadAndStoreMedia(tenantId, msg, result.msgId).catch(() => null);
        }
      }
    }
  });

  // ── Delivery / read receipts ──────────────────────────────────────────────
  sock.ev.on('message-receipt.update', async (receipts) => {
    for (const receipt of receipts) {
      const wamid = receipt.key?.id;
      if (!wamid) continue;

      let newStatus: string | null = null;
      if (receipt.receipt?.readTimestamp)     newStatus = 'read';
      else if (receipt.receipt?.receiptTimestamp) newStatus = 'delivered';
      if (!newStatus) continue;

      const upd = await query(
        `UPDATE messages SET status=$1 WHERE wamid=$2 AND tenant_id=$3::uuid RETURNING id`,
        [newStatus, wamid, tenantId],
      ).catch(() => null);

      if (upd?.rows[0]) {
        emitToTenant(tenantId, 'message:updated', {
          id:     upd.rows[0].id,
          wamid,
          status: newStatus,
        });
      }
    }
  });

  // ── Message revocation ────────────────────────────────────────────────────
  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      const wamid = update.key?.id;
      if (!wamid) continue;

      const proto = (update.update as any)?.message?.protocolMessage;
      if (proto?.type !== 5) continue;

      const upd = await query(
        `UPDATE messages SET is_deleted=TRUE, body='[Message deleted]'
         WHERE wamid=$1 AND tenant_id=$2::uuid RETURNING id`,
        [wamid, tenantId],
      ).catch(() => null);

      if (upd?.rows[0]) {
        emitToTenant(tenantId, 'message:updated', {
          id:         upd.rows[0].id,
          wamid,
          is_deleted: true,
          body:       '[Message deleted]',
        });
      }
    }
  });

  // ── Contact name sync ─────────────────────────────────────────────────────
  sock.ev.on('contacts.upsert', async (contacts) => {
    const cached: { id: string; name: string; phone: string }[] = waContactsCache.get(tenantId) ?? [];
    for (const contact of contacts) {
      const digits = contact.id?.split('@')[0];
      if (!digits) continue;

      const rawLid = (contact as any).lid;
      if (contact.id?.endsWith('@lid') || rawLid) {
        console.log(`[WA] contacts.upsert entry: id=${contact.id} lid=${rawLid ?? 'none'} name=${contact.name ?? ''}`);
      }

      const lidDigits = rawLid?.split('@')[0];
      if (lidDigits && digits && !lidToPhone.has(lidDigits)) {
        await storeLidMapping(tenantId, lidDigits, digits);
      }
      if (!lidDigits && contact.id?.endsWith('@lid')) {
        console.log(`[WA] contacts.upsert: @lid contact with no phone JID yet: ${contact.id}`);
      }

      if (contact.name) {
        const idx = cached.findIndex((c) => c.id === contact.id);
        const entry = { id: contact.id, name: contact.name, phone: digits };
        if (idx >= 0) cached[idx] = entry; else cached.push(entry);

        await query(
          `UPDATE leads
           SET name=$1, updated_at=NOW()
           WHERE tenant_id=$2::uuid
             AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE '%' || RIGHT($3, 10)
             AND (
               name = phone
               OR name ~ '^[+0-9][0-9 ()\\-]{6,}$'
             )`,
          [contact.name, tenantId, digits],
        ).catch(() => null);
      }
    }
    waContactsCache.set(tenantId, cached);
  });
}

export async function stopSession(tenantId: string, sessionId: string, updateDb = true): Promise<void> {
  const key = skey(tenantId, sessionId);
  intentionallyStopped.add(key);
  setTimeout(() => intentionallyStopped.delete(key), 3000);

  const sock = sessions.get(key);
  if (sock) {
    try { sock.end(undefined as any); } catch {}
    sessions.delete(key);
  }
  connectedSessions.delete(key);
  if (updateDb) {
    await upsertSessionStatus(tenantId, sessionId, 'disconnected').catch(() => null);
  }
}

export async function destroySession(tenantId: string, sessionId: string): Promise<void> {
  const key = skey(tenantId, sessionId);
  retryCount.delete(key);
  await stopSession(tenantId, sessionId, true);
  try { fs.rmSync(sessionDir(tenantId, sessionId), { recursive: true, force: true }); } catch {}
  pendingQRs.delete(key);
}

/** Get a specific session socket, or the first connected session for the tenant */
export function getSession(tenantId: string, sessionId?: string): ReturnType<typeof makeWASocket> | null {
  if (sessionId) {
    return sessions.get(skey(tenantId, sessionId)) ?? null;
  }
  // Find the first connected session for this tenant
  for (const [k, sock] of sessions) {
    if (k.startsWith(`${tenantId}::`) && connectedSessions.has(k)) return sock;
  }
  // Fall back to any session for this tenant
  for (const [k, sock] of sessions) {
    if (k.startsWith(`${tenantId}::`)) return sock;
  }
  return null;
}

/** Get the session ID of the first connected session for the tenant */
export function getFirstConnectedSessionId(tenantId: string): string | null {
  for (const k of connectedSessions) {
    if (k.startsWith(`${tenantId}::`)) return k.split('::')[1];
  }
  return null;
}

export function getQR(tenantId: string, sessionId: string): string | null {
  return pendingQRs.get(skey(tenantId, sessionId)) ?? null;
}

export async function getStatus(tenantId: string, sessionId: string): Promise<{ status: string; phone: string | null }> {
  const key = skey(tenantId, sessionId);
  const res = await query(
    'SELECT phone_number FROM wa_personal_sessions WHERE session_id=$1::uuid',
    [sessionId],
  );
  const phone = res.rows[0]?.phone_number ?? null;

  if (connectedSessions.has(key)) return { status: 'connected', phone };
  if (sessions.has(key))          return { status: 'connecting', phone: null };
  return { status: 'disconnected', phone };
}

/** List all sessions for a tenant */
export async function listSessions(tenantId: string): Promise<{ session_id: string; session_name: string; status: string; phone_number: string | null; connected_at: string | null }[]> {
  const res = await query(
    `SELECT session_id, COALESCE(session_name, 'Default') AS session_name, status, phone_number, connected_at
     FROM wa_personal_sessions WHERE tenant_id=$1::uuid ORDER BY connected_at ASC NULLS LAST`,
    [tenantId],
  );
  // Override DB status with in-memory truth
  return res.rows.map((r: any) => {
    const key = skey(tenantId, r.session_id);
    let status = r.status;
    if (connectedSessions.has(key)) status = 'connected';
    else if (sessions.has(key)) status = 'connecting';
    return { ...r, status };
  });
}

/** Create a new session record in DB (does not start the WA connection) */
export async function createSession(tenantId: string, name?: string): Promise<string> {
  const res = await query(
    `INSERT INTO wa_personal_sessions (session_id, tenant_id, status, session_name)
     VALUES (gen_random_uuid(), $1::uuid, 'disconnected', $2) RETURNING session_id`,
    [tenantId, name || 'WhatsApp Session'],
  );
  return res.rows[0].session_id;
}

/** Delete a session record from DB and clean up files */
export async function deleteSession(tenantId: string, sessionId: string): Promise<void> {
  await destroySession(tenantId, sessionId);
  await query('DELETE FROM wa_personal_sessions WHERE session_id=$1::uuid AND tenant_id=$2::uuid', [sessionId, tenantId]);
}

/** Rename a session */
export async function renameSession(tenantId: string, sessionId: string, name: string): Promise<void> {
  await query(
    'UPDATE wa_personal_sessions SET session_name=$1 WHERE session_id=$2::uuid AND tenant_id=$3::uuid',
    [name, sessionId, tenantId],
  );
}

/** Returns WA phone-book contacts cached from contacts.upsert events. */
export function getWAContacts(tenantId: string): { id: string; name: string; phone: string }[] {
  return waContactsCache.get(tenantId) ?? [];
}

/** Restores tenants that had an active session saved to disk on server boot. */
export async function restoreAllSessions(): Promise<void> {
  if (!fs.existsSync(WA_SESSIONS_DIR)) return;

  for (const dirName of fs.readdirSync(WA_SESSIONS_DIR)) {
    const dir = path.join(WA_SESSIONS_DIR, dirName);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (fs.readdirSync(dir).length === 0) continue;

    if (dirName.includes('_')) {
      // New format: tenantId_sessionId
      const [tenantId, sessionId] = dirName.split('_');
      if (tenantId && sessionId) {
        startSession(tenantId, sessionId).catch(() => null);
      }
    } else {
      // Legacy format: tenantId only — look up session_id from DB, or migrate
      const tenantId = dirName;
      try {
        const existing = await query(
          'SELECT session_id FROM wa_personal_sessions WHERE tenant_id=$1::uuid LIMIT 1',
          [tenantId],
        );
        let sessionId: string;
        if (existing.rows[0]) {
          sessionId = existing.rows[0].session_id;
        } else {
          // Create a session record for this legacy session
          const ins = await query(
            `INSERT INTO wa_personal_sessions (session_id, tenant_id, status, session_name)
             VALUES (gen_random_uuid(), $1::uuid, 'disconnected', 'Default') RETURNING session_id`,
            [tenantId],
          );
          sessionId = ins.rows[0].session_id;
        }
        // Move legacy dir to new format
        const newDir = sessionDir(tenantId, sessionId);
        if (!fs.existsSync(newDir)) {
          fs.renameSync(dir, newDir);
          console.log(`[WA] Migrated legacy session dir: ${dirName} -> ${tenantId}_${sessionId}`);
        }
        startSession(tenantId, sessionId).catch(() => null);
      } catch (e) {
        console.error(`[WA] Failed to restore legacy session ${tenantId}:`, e);
      }
    }
  }
}

/**
 * Sends a text message via Personal WhatsApp.
 * Returns the WA message ID (wamid) so callers can store it for receipt tracking.
 */
export async function sendText(tenantId: string, jid: string, text: string, sessionId?: string): Promise<string | null> {
  const key = sessionId ? skey(tenantId, sessionId) : null;
  let sock: ReturnType<typeof makeWASocket> | null = null;
  let actualKey: string | null = null;

  if (key && sessions.has(key) && connectedSessions.has(key)) {
    sock = sessions.get(key)!;
    actualKey = key;
  } else {
    // Find first connected session for tenant
    for (const [k, s] of sessions) {
      if (k.startsWith(`${tenantId}::`) && connectedSessions.has(k)) {
        sock = s;
        actualKey = k;
        break;
      }
    }
  }

  if (!sock || !actualKey || !connectedSessions.has(actualKey)) {
    throw new Error('WhatsApp Personal session not connected');
  }
  const sessionPhone = sock.user?.id ? jidNormalizedUser(sock.user.id).split('@')[0] : null;

  // Pre-populate LID mapping
  const recipientDigits = jid.split('@')[0];
  if (recipientDigits && !jid.endsWith('@lid') && ![...lidToPhone.values()].includes(recipientDigits)) {
    lookupLidForPhonesBatch(sock as any, [recipientDigits]).then(async (map) => {
      for (const [phone, lidDigits] of map) {
        if (!lidToPhone.has(lidDigits)) {
          await storeLidMapping(tenantId, lidDigits, phone).catch(() => null);
        }
      }
    }).catch(() => null);
  }

  const result = await sock.sendMessage(jid, { text });
  const wamid  = result?.key?.id ?? null;

  await query(
    `INSERT INTO wa_personal_stats (tenant_id, date, messages_sent, wa_account)
     VALUES ($1::uuid, CURRENT_DATE, 1, $2)
     ON CONFLICT (tenant_id, date) DO UPDATE SET messages_sent = wa_personal_stats.messages_sent + 1`,
    [tenantId, sessionPhone],
  ).catch(() => null);

  if (wamid && sessionPhone) {
    await query(
      `UPDATE messages SET wa_account=$1 WHERE wamid=$2 AND tenant_id=$3::uuid`,
      [sessionPhone, wamid, tenantId],
    ).catch(() => null);
  }

  return wamid;
}

function extractVideoThumbnail(buffer: Buffer): string | null {
  const id = crypto.randomBytes(8).toString('hex');
  const tmpIn  = path.join(os.tmpdir(), `wa_vid_${id}.mp4`);
  const tmpOut = path.join(os.tmpdir(), `wa_thumb_${id}.jpg`);
  try {
    fs.writeFileSync(tmpIn, buffer);
    execFileSync('ffmpeg', [
      '-y', '-i', tmpIn,
      '-vf', 'select=eq(n,0)',
      '-vframes', '1',
      '-s', '320x240',
      '-f', 'image2',
      tmpOut,
    ], { timeout: 10000, stdio: 'pipe' });
    if (!fs.existsSync(tmpOut)) return null;
    return fs.readFileSync(tmpOut).toString('base64');
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmpIn); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}

/**
 * Sends a media file via Personal WhatsApp.
 */
export async function sendMedia(
  tenantId: string,
  jid: string,
  buffer: Buffer,
  mimetype: string,
  fileName: string,
  caption?: string,
  sessionId?: string,
): Promise<string | null> {
  const key = sessionId ? skey(tenantId, sessionId) : null;
  let sock: ReturnType<typeof makeWASocket> | null = null;
  let actualKey: string | null = null;

  if (key && sessions.has(key) && connectedSessions.has(key)) {
    sock = sessions.get(key)!;
    actualKey = key;
  } else {
    for (const [k, s] of sessions) {
      if (k.startsWith(`${tenantId}::`) && connectedSessions.has(k)) {
        sock = s;
        actualKey = k;
        break;
      }
    }
  }

  if (!sock || !actualKey || !connectedSessions.has(actualKey)) {
    throw new Error('WhatsApp Personal session not connected');
  }

  let content: any;
  if (mimetype.startsWith('image/')) {
    content = { image: buffer, mimetype, caption: caption ?? '' };
  } else if (mimetype.startsWith('video/')) {
    const jpegThumbnail = extractVideoThumbnail(buffer);
    content = { video: buffer, mimetype, caption: caption ?? '', ...(jpegThumbnail ? { jpegThumbnail } : {}) };
  } else if (mimetype.startsWith('audio/')) {
    content = { audio: buffer, mimetype, ptt: false };
  } else {
    content = { document: buffer, mimetype, fileName, caption: caption ?? '' };
  }

  const sessionPhone = sock.user?.id ? jidNormalizedUser(sock.user.id).split('@')[0] : null;
  const result = await sock.sendMessage(jid, content);
  const wamid  = result?.key?.id ?? null;

  await query(
    `INSERT INTO wa_personal_stats (tenant_id, date, messages_sent, wa_account)
     VALUES ($1::uuid, CURRENT_DATE, 1, $2)
     ON CONFLICT (tenant_id, date) DO UPDATE SET messages_sent = wa_personal_stats.messages_sent + 1`,
    [tenantId, sessionPhone],
  ).catch(() => null);

  if (wamid && sessionPhone) {
    await query(
      `UPDATE messages SET wa_account=$1 WHERE wamid=$2 AND tenant_id=$3::uuid`,
      [sessionPhone, wamid, tenantId],
    ).catch(() => null);
  }

  return wamid;
}
