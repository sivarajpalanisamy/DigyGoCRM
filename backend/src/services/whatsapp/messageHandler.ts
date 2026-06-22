import { query } from '../../db';
import { emitToTenant } from '../../socket';
import { emitLeadCreated } from '../../utils/leadEvents';
import { normalizePhone, fromJID, isGroupJID } from './phoneUtils';

/**
 * Unwraps container message types (disappearing, view-once, etc.)
 * then extracts a human-readable text label from the inner content.
 */
function extractText(msg: any): string {
  const m = msg.message;
  if (!m) return '';

  const inner: any =
    m.ephemeralMessage?.message ??
    m.viewOnceMessage?.message ??
    m.viewOnceMessageV2?.message ??
    m.viewOnceMessageV2Extension?.message ??
    m.documentWithCaptionMessage?.message ??
    m.editedMessage?.message ??
    m;

  // Skip known protocol/system message types — no human content
  if (inner.senderKeyDistributionMessage) return '';
  if (inner.protocolMessage)              return '';
  // messageContextInfo is ONLY a system frame when it is the sole key — skip only in that case
  if (inner.messageContextInfo && !inner.conversation && !inner.extendedTextMessage &&
      !inner.imageMessage && !inner.videoMessage && !inner.audioMessage &&
      !inner.documentMessage && !inner.stickerMessage && !inner.reactionMessage) return '';

  if (inner.conversation)              return inner.conversation;
  if (inner.extendedTextMessage?.text) return inner.extendedTextMessage.text;

  if (inner.imageMessage)    return inner.imageMessage.caption?.trim()    || '[Image]';
  if (inner.videoMessage)    return inner.videoMessage.caption?.trim()    || '[Video]';
  if (inner.audioMessage)    return inner.audioMessage.ptt                ? '[Voice note]' : '[Audio]';
  if (inner.documentMessage) return inner.documentMessage.fileName
    ? `[Document: ${inner.documentMessage.fileName}]` : '[Document]';

  if (inner.stickerMessage)             return '[Sticker]';
  if (inner.locationMessage)            return '[Location]';
  if (inner.liveLocationMessage)        return '[Live Location]';
  if (inner.contactMessage)             return `[Contact: ${inner.contactMessage.displayName ?? 'Unknown'}]`;
  if (inner.contactsArrayMessage)       return '[Contacts]';
  if (inner.reactionMessage)            return `[Reaction: ${inner.reactionMessage.text ?? ''}]`;
  if (inner.pollCreationMessage)        return `[Poll: ${inner.pollCreationMessage.name ?? ''}]`;
  if (inner.pollUpdateMessage)          return '[Poll vote]';
  if (inner.buttonsResponseMessage)     return inner.buttonsResponseMessage.selectedDisplayText   || '[Button reply]';
  if (inner.listResponseMessage)        return inner.listResponseMessage.title                    || '[List reply]';
  if (inner.templateButtonReplyMessage) return inner.templateButtonReplyMessage.selectedDisplayText || '[Reply]';
  if (inner.groupInviteMessage)         return `[Group invite: ${inner.groupInviteMessage.groupName ?? ''}]`;
  if (inner.orderMessage)               return '[Order]';
  if (inner.productMessage)             return '[Product]';
  if (inner.paymentMessage)             return '[Payment]';

  return '[Media message]';
}

/** Returns true if the message carries a downloadable media attachment. */
function detectMedia(msg: any): boolean {
  const m = msg.message;
  if (!m) return false;
  const inner: any =
    m.ephemeralMessage?.message ??
    m.viewOnceMessage?.message ??
    m.viewOnceMessageV2?.message ??
    m.viewOnceMessageV2Extension?.message ??
    m.documentWithCaptionMessage?.message ??
    m.editedMessage?.message ??
    m;
  return !!(
    inner.imageMessage ||
    inner.videoMessage ||
    inner.audioMessage ||
    inner.documentMessage ||
    inner.stickerMessage
  );
}

/**
 * Processes one Baileys message and persists it to the DB.
 *
 * @param opts.historical  true for history-sync messages (type:'append') —
 *                         skips socket emit, workflow trigger, and unread increment.
 *
 * @returns { msgId, hasMedia } on success, or null if the message was a duplicate / empty.
 */
export async function handleInboundMessage(
  tenantId: string,
  msg: any,
  opts?: { historical?: boolean; waPhone?: string | null },
): Promise<{ msgId: string; hasMedia: boolean } | null> {
  if (!msg.message) { console.log('[MSG] skip: no message body'); return null; }

  const remoteJID = msg.key?.remoteJid ?? '';
  if (!remoteJID || !remoteJID.includes('@')) { console.log('[MSG] skip: bad remoteJid', remoteJID); return null; }
  if (remoteJID === 'status@broadcast') return null;
  if (isGroupJID(remoteJID)) { console.log('[MSG] skip: group jid'); return null; }

  const fromMe: boolean  = msg.key?.fromMe ?? false;
  const historical       = opts?.historical ?? false;
  const waPhone          = opts?.waPhone ?? null;
  const rawPhone   = fromJID(remoteJID);
  // @lid JIDs are multi-device WA identifiers. Check the LID→phone map first so we always
  // store and display the real phone number, not the 14-digit LID identifier.
  let isLid = remoteJID.endsWith('@lid');
  let phone: string;
  if (isLid) {
    const lidMap = await query(
      'SELECT phone_digits FROM wa_lid_phone_map WHERE tenant_id=$1::uuid AND lid_digits=$2',
      [tenantId, rawPhone],
    ).catch(() => null);
    if (lidMap?.rows[0]?.phone_digits) {
      phone = normalizePhone(lidMap.rows[0].phone_digits);
      isLid = false;
    } else {
      // Mapping not yet known — use LID digits temporarily; storeLidMapping will fix it later
      phone = rawPhone;
    }
  } else {
    phone = normalizePhone(rawPhone);
  }
  if (!phone || phone.length > 15) { console.log('[MSG] skip: invalid phone', phone); return null; }

  const hasMedia = detectMedia(msg);
  const text     = extractText(msg);
  console.log(`[MSG] remoteJid=${remoteJID} fromMe=${fromMe} phone=${phone} isLid=${isLid} text="${text}" hasMedia=${hasMedia} historical=${historical}`);
  if (!text) { console.log('[MSG] skip: empty text'); return null; }
  if (text === '[Media message]' && !hasMedia) { console.log('[MSG] skip: protocol catch-all'); return null; }

  // Use the WA message timestamp (unix seconds); fall back to NOW() only if missing
  const msgTimestamp: Date = msg.messageTimestamp
    ? new Date(Number(msg.messageTimestamp) * 1000)
    : new Date();

  // ── Find matching lead by last-10-digit phone match ──────────────────────
  const leadRes = await query(
    `SELECT id, name, phone, assigned_to
     FROM leads
     WHERE tenant_id=$1::uuid AND is_deleted=FALSE
       AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE '%' || RIGHT(REGEXP_REPLACE($2, '[^0-9]', '', 'g'), 10)
     LIMIT 1`,
    [tenantId, phone],
  );
  let lead   = leadRes.rows[0] ?? null;
  let leadId = lead?.id ?? null;

  // Friendly name for the contact — WA push name if available, otherwise a readable fallback
  const pushName = msg.pushName as string | null ?? null;
  const pushNameForLead = pushName || (isLid ? `WA Contact (${phone.slice(-6)})` : `+${phone}`);

  // ── Auto-create lead for inbound messages from unknown numbers ────────────
  // Only if: inbound (not fromMe), no existing lead, not historical sync,
  // and tenant has wa_auto_create_lead enabled in settings.
  if (!lead && !fromMe && !historical) {
    try {
      const settingsRes = await query(
        `SELECT settings FROM tenants WHERE id=$1::uuid`,
        [tenantId],
      );
      const settings = settingsRes.rows[0]?.settings ?? {};
      if (settings.wa_auto_create_lead) {
        const newLead = await query(
          `INSERT INTO leads (tenant_id, name, phone, source, pipeline_id, stage_id, created_at, updated_at)
           SELECT $1::uuid, $2, $3, 'personal_wa', p.id, s.id, NOW(), NOW()
           FROM pipelines p
           LEFT JOIN pipeline_stages s ON s.pipeline_id = p.id
           WHERE p.tenant_id=$1::uuid AND p.is_deleted=FALSE
           ORDER BY p.created_at ASC, s.position ASC
           LIMIT 1
           RETURNING id, name, phone`,
          [tenantId, pushNameForLead, `+${phone}`],
        );
        if (newLead.rows[0]) {
          lead   = newLead.rows[0];
          leadId = newLead.rows[0].id;
          emitLeadCreated(tenantId, leadId).catch(() => null);
        }
      }
    } catch { /* best-effort */ }
  }

  const leadName = lead?.name ?? pushNameForLead;

  // ── Find or create conversation ───────────────────────────────────────────
  // wa_account is metadata only — never used as a filter (would create duplicates on session switch)
  let convId: string;
  if (leadId) {
    const existing = await query(
      `SELECT id FROM conversations
       WHERE tenant_id=$1::uuid AND channel='personal_wa' AND lead_id=$2::uuid
       ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
      [tenantId, leadId],
    );
    if (existing.rows[0]) {
      convId = existing.rows[0].id;
      // Keep wa_account updated to reflect current active session
      if (waPhone) await query(
        `UPDATE conversations SET wa_account=$1 WHERE id=$2 AND wa_account IS DISTINCT FROM $1`,
        [waPhone, convId],
      ).catch(() => null);
    } else {
      const newConv = await query(
        `INSERT INTO conversations (tenant_id, lead_id, channel, status, unread_count, last_message_at, wa_account)
         VALUES ($1::uuid, $2::uuid, 'personal_wa', 'open', 0, NOW(), $3) RETURNING id`,
        [tenantId, leadId, waPhone],
      );
      convId = newConv.rows[0].id;
    }
  } else {
    const existing = await query(
      `SELECT id FROM conversations
       WHERE tenant_id=$1::uuid AND channel='personal_wa' AND lead_id IS NULL
         AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE '%' || RIGHT(REGEXP_REPLACE($2, '[^0-9]', '', 'g'), 10)
       ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
      [tenantId, phone],
    );
    if (existing.rows[0]) {
      convId = existing.rows[0].id;
      // Normalize stored phone to full format while we're here
      await query(
        `UPDATE conversations SET phone=$1, wa_account=COALESCE(CASE WHEN $2::text IS NOT NULL THEN $2::text END, wa_account)
         WHERE id=$3 AND (phone IS DISTINCT FROM $1 OR wa_account IS DISTINCT FROM $2)`,
        [phone, waPhone, convId],
      ).catch(() => null);
    } else {
      const newConv = await query(
        `INSERT INTO conversations (tenant_id, lead_id, channel, status, unread_count, last_message_at, phone, wa_account)
         VALUES ($1::uuid, NULL, 'personal_wa', 'open', 0, NOW(), $2, $3) RETURNING id`,
        [tenantId, phone, waPhone],
      );
      convId = newConv.rows[0].id;
    }
  }

  // ── Insert message (idempotent on wamid) ─────────────────────────────────
  const wamid      = msg.key?.id ?? null;
  const sender     = fromMe ? 'agent' : 'customer';
  const initStatus = fromMe ? 'sent' : 'delivered';

  const msgRes = await query(
    `INSERT INTO messages
       (conversation_id, tenant_id, lead_id, sender, body, is_note, wamid, remote_jid, status, sent_by, created_at, wa_account)
     VALUES ($1, $2::uuid, $3, $4, $5, FALSE, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (wamid) WHERE wamid IS NOT NULL
     DO UPDATE SET remote_jid = COALESCE(messages.remote_jid, EXCLUDED.remote_jid)
     RETURNING *`,
    [convId, tenantId, leadId, sender, text, wamid, remoteJID || null, initStatus, fromMe ? 'manual' : 'customer', msgTimestamp, waPhone ?? null],
  );

  if (!msgRes.rows[0]) return null; // Already processed (duplicate)

  const msgId = msgRes.rows[0].id as string;

  // ── Update conversation preview ───────────────────────────────────────────
  if (historical) {
    // Only update if this message is actually newer than the stored preview
    await query(
      `UPDATE conversations
       SET last_message     = CASE WHEN last_message_at IS NULL OR last_message_at < $1 THEN $2 ELSE last_message END,
           last_message_at  = CASE WHEN last_message_at IS NULL OR last_message_at < $1 THEN $1 ELSE last_message_at END
       WHERE id = $3`,
      [msgTimestamp, text.slice(0, 200), convId],
    );
    // No socket emit, no workflow trigger, no unread increment for history sync
    return { msgId, hasMedia };
  }

  if (fromMe) {
    // Message sent from the owner's phone (not via CRM) — update preview only
    await query(
      `UPDATE conversations SET last_message=$1, last_message_at=$2 WHERE id=$3`,
      [text.slice(0, 200), msgTimestamp, convId],
    );
  } else {
    // Inbound customer message — increment unread and update preview
    await query(
      `UPDATE conversations
       SET last_message=$1, last_message_at=$2, unread_count=unread_count+1
       WHERE id=$3`,
      [text.slice(0, 200), msgTimestamp, convId],
    );

    await query(
      `INSERT INTO wa_personal_stats (tenant_id, date, messages_received)
       VALUES ($1::uuid, CURRENT_DATE, 1)
       ON CONFLICT (tenant_id, date) DO UPDATE SET messages_received = wa_personal_stats.messages_received + 1`,
      [tenantId],
    ).catch(() => null);
  }

  // ── Real-time socket events ───────────────────────────────────────────────
  emitToTenant(tenantId, 'message:new', {
    ...msgRes.rows[0],
    lead_name:  leadName,
    lead_phone: `+${phone}`,
    channel:    'personal_wa',
  });
  emitToTenant(tenantId, 'conversation:updated', {
    id:             convId,
    lead_id:        leadId,
    lead_name:      leadName,
    lead_phone:     `+${phone}`,
    channel:        'personal_wa',
    status:         'open',
    last_message:   text.slice(0, 200),
    last_message_at: msgTimestamp.toISOString(),
    ...(fromMe ? {} : { unread_count: 1 }),
  });

  // ── Workflow trigger (inbound only) ───────────────────────────────────────
  if (!fromMe && lead) {
    try {
      const { triggerWorkflows } = await import('../../routes/workflows');
      await triggerWorkflows('inbox_message', {
        id: lead.id, name: lead.name, phone: lead.phone,
        assigned_to: lead.assigned_to, tenant_id: tenantId,
      } as any, tenantId, 'system',
        { triggerContext: { channel: 'personal_wa', messageBody: text, waPhone: waPhone ?? undefined } }
      );
    } catch { /* ignore */ }
  }

  return { msgId, hasMedia };
}
