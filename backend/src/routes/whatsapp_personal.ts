import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';
import {
  startSession, stopSession, destroySession, deleteSession,
  getQR, getStatus, sendText, sendMedia, listSessions, createSession, renameSession,
  getFirstConnectedSessionId,
} from '../services/whatsapp/sessionManager';
import { toJID } from '../services/whatsapp/phoneUtils';
import { emitToTenant } from '../socket';
import { interpolate, LeadContext } from './workflows';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// ── Multi-session endpoints ─────────────────────────────────────────────────

// GET /api/whatsapp-personal/sessions — list all sessions for this tenant
router.get('/sessions', async (req: AuthRequest, res: Response) => {
  try {
    const sessions = await listSessions(req.user!.tenantId!);
    res.json(sessions);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/whatsapp-personal/sessions — create a new session
router.post('/sessions', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { name } = req.body as { name?: string };
  try {
    const sessionId = await createSession(req.user!.tenantId!, name);
    res.status(201).json({ session_id: sessionId });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Failed to create session' });
  }
});

// PATCH /api/whatsapp-personal/sessions/:sessionId — rename session
router.patch('/sessions/:sessionId', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return; }
  try {
    await renameSession(req.user!.tenantId!, req.params.sessionId, name.trim());
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/whatsapp-personal/sessions/:sessionId — destroy session + files + DB
router.delete('/sessions/:sessionId', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await deleteSession(req.user!.tenantId!, req.params.sessionId);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/whatsapp-personal/sessions/:sessionId/connect — start QR for session
router.post('/sessions/:sessionId/connect', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const { sessionId } = req.params;
  try {
    await destroySession(tenantId, sessionId).catch(() => null);
    await new Promise<void>((r) => setTimeout(r, 300));
    await startSession(tenantId, sessionId);
    res.json({ success: true, message: 'Session starting — scan the QR code' });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Failed to start session' });
  }
});

// POST /api/whatsapp-personal/sessions/:sessionId/disconnect — stop session
router.post('/sessions/:sessionId/disconnect', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await destroySession(req.user!.tenantId!, req.params.sessionId);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/whatsapp-personal/sessions/:sessionId/qr
router.get('/sessions/:sessionId/qr', async (req: AuthRequest, res: Response) => {
  const qr = getQR(req.user!.tenantId!, req.params.sessionId);
  res.json({ qr });
});

// GET /api/whatsapp-personal/sessions/:sessionId/status
router.get('/sessions/:sessionId/status', async (req: AuthRequest, res: Response) => {
  try {
    const status = await getStatus(req.user!.tenantId!, req.params.sessionId);
    res.json(status);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/whatsapp-personal/devices — enriched device list with message counts + assigned staff
router.get('/devices', async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  try {
    const sessions = await listSessions(tenantId);
    // Get total message counts per session from wa_personal_stats
    const statsRes = await query(
      `SELECT session_id, COALESCE(SUM(messages_sent),0)::int + COALESCE(SUM(messages_received),0)::int AS total_messages
       FROM wa_personal_stats WHERE tenant_id=$1::uuid AND session_id IS NOT NULL GROUP BY session_id`,
      [tenantId],
    );
    const statsMap: Record<string, number> = {};
    for (const r of statsRes.rows) statsMap[r.session_id] = Number(r.total_messages);

    // If no per-session stats, get tenant-wide total for the first/only session
    if (sessions.length > 0 && Object.keys(statsMap).length === 0) {
      const fallback = await query(
        `SELECT COALESCE(SUM(messages_sent),0)::int + COALESCE(SUM(messages_received),0)::int AS total FROM wa_personal_stats WHERE tenant_id=$1::uuid`,
        [tenantId],
      );
      if (sessions.length === 1 && fallback.rows[0]) {
        statsMap[sessions[0].session_id] = Number(fallback.rows[0].total);
      }
    }

    // Get assigned_staff for each session
    const staffRes = await query(
      `SELECT session_id, COALESCE(assigned_staff, '[]'::jsonb) AS assigned_staff FROM wa_personal_sessions WHERE tenant_id=$1::uuid`,
      [tenantId],
    );
    const staffMap: Record<string, string[]> = {};
    for (const r of staffRes.rows) staffMap[r.session_id] = r.assigned_staff ?? [];

    // Get staff names for display
    const allStaffIds = [...new Set(Object.values(staffMap).flat())];
    let staffNames: Record<string, string> = {};
    if (allStaffIds.length > 0) {
      const namesRes = await query(
        `SELECT id, name FROM users WHERE id = ANY($1::uuid[]) AND tenant_id=$2::uuid`,
        [allStaffIds, tenantId],
      );
      for (const r of namesRes.rows) staffNames[r.id] = r.name;
    }

    const devices = sessions.map((s: any) => ({
      ...s,
      total_messages: statsMap[s.session_id] ?? 0,
      assigned_staff: (staffMap[s.session_id] ?? []).map((id: string) => ({ id, name: staffNames[id] ?? 'Unknown' })),
    }));

    res.json(devices);
  } catch (err: any) {
    console.error('[WA devices]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/whatsapp-personal/sessions/:sessionId/staff — update assigned staff
router.patch('/sessions/:sessionId/staff', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { staff_ids } = req.body as { staff_ids: string[] };
  if (!Array.isArray(staff_ids)) { res.status(400).json({ error: 'staff_ids must be an array' }); return; }
  try {
    await query(
      `UPDATE wa_personal_sessions SET assigned_staff = $1::jsonb WHERE session_id = $2::uuid AND tenant_id = $3::uuid`,
      [JSON.stringify(staff_ids), req.params.sessionId, req.user!.tenantId],
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Legacy endpoints (backward compatible) ──────────────────────────────────

// GET /api/whatsapp-personal/status — returns first session status
router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user!.tenantId!;
    const sessionId = getFirstConnectedSessionId(tenantId);
    if (sessionId) {
      const status = await getStatus(tenantId, sessionId);
      res.json(status);
    } else {
      // Check DB for any session
      const dbRow = await query(
        'SELECT session_id, status, phone_number FROM wa_personal_sessions WHERE tenant_id=$1::uuid LIMIT 1',
        [tenantId],
      );
      if (dbRow.rows[0]) {
        res.json({ status: dbRow.rows[0].status, phone: dbRow.rows[0].phone_number });
      } else {
        res.json({ status: 'disconnected', phone: null });
      }
    }
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/whatsapp-personal/qr — legacy: returns QR for first session
router.get('/qr', async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  // Find any pending QR for this tenant
  const sessions = await listSessions(tenantId).catch(() => []);
  for (const s of sessions) {
    const qr = getQR(tenantId, s.session_id);
    if (qr) { res.json({ qr }); return; }
  }
  res.json({ qr: null });
});

// POST /api/whatsapp-personal/connect — legacy: connect first/only session
router.post('/connect', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  try {
    // Find existing session or create one
    const existing = await query(
      'SELECT session_id FROM wa_personal_sessions WHERE tenant_id=$1::uuid LIMIT 1',
      [tenantId],
    );
    let sessionId: string;
    if (existing.rows[0]) {
      sessionId = existing.rows[0].session_id;
    } else {
      sessionId = await createSession(tenantId, 'Default');
    }
    await destroySession(tenantId, sessionId).catch(() => null);
    await new Promise<void>((r) => setTimeout(r, 300));
    await startSession(tenantId, sessionId);
    res.json({ success: true, message: 'Session starting — scan the QR code' });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Failed to start session' });
  }
});

// DELETE /api/whatsapp-personal/disconnect — legacy: disconnect first session
router.delete('/disconnect', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  try {
    const existing = await query(
      'SELECT session_id FROM wa_personal_sessions WHERE tenant_id=$1::uuid LIMIT 1',
      [tenantId],
    );
    if (existing.rows[0]) {
      await destroySession(tenantId, existing.rows[0].session_id);
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/whatsapp-personal/send — send message to a lead/number
router.post('/send', checkPermission('inbox:send'), async (req: AuthRequest, res: Response) => {
  const { lead_id, phone, message, session_id, template_id } = req.body as {
    lead_id?: string; phone?: string; message: string; session_id?: string; template_id?: string;
  };
  const { tenantId, userId } = req.user!;

  if (!message?.trim()) { res.status(400).json({ error: 'message required' }); return; }

  try {
    let targetPhone = phone;
    let leadId = lead_id ?? null;
    let leadName = '';
    let leadCtx: LeadContext | null = null;

    if (lead_id) {
      const leadRes = await query(
        `SELECT l.id, l.name, l.email, l.phone, l.source, l.status, l.custom_fields,
                l.assigned_to, l.created_at,
                ps.name AS stage_name, p.name AS pipeline_name,
                u.name AS assigned_staff_name
         FROM leads l
         LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
         LEFT JOIN pipelines p ON p.id = l.pipeline_id
         LEFT JOIN users u ON u.id = l.assigned_to
         WHERE l.id=$1::uuid AND l.tenant_id=$2::uuid AND l.is_deleted=FALSE`,
        [lead_id, tenantId],
      );
      if (!leadRes.rows[0]) { res.status(404).json({ error: 'Lead not found' }); return; }
      const row = leadRes.rows[0];
      targetPhone = row.phone;
      leadName = row.name;
      leadCtx = {
        id: row.id, name: row.name ?? '', email: row.email, phone: row.phone,
        stage_name: row.stage_name, pipeline_name: row.pipeline_name,
        assigned_staff_name: row.assigned_staff_name, assigned_staff_id: row.assigned_to,
        source: row.source, status: row.status,
        custom_fields: row.custom_fields ?? {}, created_at: row.created_at,
      };
    }

    if (!targetPhone) { res.status(400).json({ error: 'phone or lead_id required' }); return; }

    // Convert markdown bold/italic to WhatsApp format: **text** → *text*, __text__ → _text_
    let msgText = message.trim()
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      .replace(/__(.+?)__/g, '_$1_');

    // Interpolate variables if we have lead context
    const finalMessage = leadCtx ? interpolate(msgText, leadCtx) : msgText;

    const jid = toJID(targetPhone);

    // Check for template attachment
    let hasAttachment = false;
    let wamid: string | null = null;
    if (template_id) {
      const tplRes = await query(
        `SELECT file_path, file_type, file_name FROM wa_personal_templates WHERE id=$1::uuid AND tenant_id=$2::uuid`,
        [template_id, tenantId],
      );
      const tpl = tplRes.rows[0];
      if (tpl?.file_path) {
        const absPath = path.resolve(process.cwd(), tpl.file_path);
        if (fs.existsSync(absPath)) {
          const buffer = fs.readFileSync(absPath);
          const mime = tpl.file_type || 'application/octet-stream';
          wamid = await sendMedia(tenantId!, jid, buffer, mime, tpl.file_name || 'attachment', finalMessage, session_id);
          hasAttachment = true;
        }
      }
    }

    if (!hasAttachment) {
      wamid = await sendText(tenantId!, jid, finalMessage, session_id);
    }

    // Find or create conversation
    let convId: string;
    const existingConv = await query(
      `SELECT id FROM conversations
       WHERE tenant_id=$1::uuid AND channel='personal_wa' AND lead_id=$2::uuid
       ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
      [tenantId, leadId],
    );

    if (existingConv.rows[0]) {
      convId = existingConv.rows[0].id;
    } else {
      const newConv = await query(
        `INSERT INTO conversations (tenant_id, lead_id, channel, status, unread_count, last_message_at)
         VALUES ($1::uuid, $2, 'personal_wa', 'open', 0, NOW()) RETURNING id`,
        [tenantId, leadId],
      );
      convId = newConv.rows[0].id;
    }

    const msgRes = await query(
      `INSERT INTO messages (conversation_id, tenant_id, lead_id, sender, body, is_note, wamid, status, sent_by, created_at)
       VALUES ($1, $2::uuid, $3, 'agent', $4, FALSE, $5, 'sent', 'manual', NOW())
       ON CONFLICT (wamid) WHERE wamid IS NOT NULL DO UPDATE SET body = EXCLUDED.body
       RETURNING *`,
      [convId, tenantId, leadId, finalMessage, wamid],
    );

    await query(
      `UPDATE conversations SET last_message=$1, last_message_at=NOW() WHERE id=$2`,
      [finalMessage.slice(0, 200), convId],
    );

    if (leadId) {
      await query(
        `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
         VALUES ($1::uuid, $2::uuid, 'whatsapp', 'WhatsApp sent (Personal)', $3, $4::uuid)`,
        [leadId, tenantId, finalMessage.slice(0, 255), userId],
      ).catch(() => null);
    }

    emitToTenant(tenantId!, 'message:new', { ...msgRes.rows[0], channel: 'personal_wa', lead_name: leadName });
    res.status(201).json({ success: true, message: msgRes.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Failed to send message' });
  }
});

// GET /api/whatsapp-personal/stats
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const [todayRes, monthRes, weekRes, sessionRes] = await Promise.all([
      query(
        `SELECT messages_sent, messages_received FROM wa_personal_stats
         WHERE tenant_id=$1::uuid AND date=CURRENT_DATE`,
        [req.user!.tenantId],
      ),
      query(
        `SELECT COALESCE(SUM(messages_sent),0) AS total_sent,
                COALESCE(SUM(messages_received),0) AS total_received
         FROM wa_personal_stats
         WHERE tenant_id=$1::uuid AND date >= DATE_TRUNC('month', CURRENT_DATE)`,
        [req.user!.tenantId],
      ),
      query(
        `SELECT date::text, COALESCE(messages_sent,0) AS sent, COALESCE(messages_received,0) AS received
         FROM wa_personal_stats
         WHERE tenant_id=$1::uuid AND date >= CURRENT_DATE - INTERVAL '6 days'
         ORDER BY date ASC`,
        [req.user!.tenantId],
      ),
      query(
        `SELECT phone, connected_at, disconnected_at, disconnect_reason
         FROM wa_session_history
         WHERE tenant_id=$1::uuid
         ORDER BY connected_at DESC LIMIT 10`,
        [req.user!.tenantId],
      ).catch(() => ({ rows: [] })),
    ]);

    res.json({
      today: {
        sent:     todayRes.rows[0]?.messages_sent     ?? 0,
        received: todayRes.rows[0]?.messages_received ?? 0,
      },
      month: {
        sent:     Number(monthRes.rows[0]?.total_sent     ?? 0),
        received: Number(monthRes.rows[0]?.total_received ?? 0),
      },
      week: weekRes.rows,
      sessions: sessionRes.rows,
    });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Analytics helpers ─────────────────────────────────────────────────────────

function periodBounds(period: string): { start: string; prevStart: string; prevEnd: string } {
  const MS_DAY = 86_400_000;
  const now = new Date();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let startMs: number;
  let durationMs: number;

  switch (period) {
    case 'today':
      startMs = todayMs; durationMs = MS_DAY; break;
    case 'yesterday':
      startMs = todayMs - MS_DAY; durationMs = MS_DAY; break;
    case 'month':
      startMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      durationMs = todayMs - startMs + MS_DAY; break;
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      startMs = new Date(now.getFullYear(), q * 3, 1).getTime();
      durationMs = todayMs - startMs + MS_DAY; break;
    }
    default: // week
      startMs = todayMs - 6 * MS_DAY; durationMs = 7 * MS_DAY;
  }

  const fmt = (ms: number) => new Date(ms).toISOString().split('T')[0];
  return { start: fmt(startMs), prevStart: fmt(startMs - durationMs), prevEnd: fmt(startMs) };
}

// GET /api/whatsapp-personal/analytics?period=week
router.get('/analytics', async (req: AuthRequest, res: Response) => {
  const { period = 'week' } = req.query as { period?: string };
  const tenantId = req.user!.tenantId!;
  const { start, prevStart, prevEnd } = periodBounds(period);
  const startTs    = start     + 'T00:00:00Z';
  const prevStartTs = prevStart + 'T00:00:00Z';
  const prevEndTs   = prevEnd   + 'T00:00:00Z';

  try {
    const [cur, prev, curContacts, prevContacts, reply] = await Promise.all([
      query(
        `SELECT COALESCE(SUM(messages_sent),0)::int AS sent,
                COALESCE(SUM(messages_received),0)::int AS received
         FROM wa_personal_stats WHERE tenant_id=$1::uuid AND date >= $2::date`,
        [tenantId, start],
      ),
      query(
        `SELECT COALESCE(SUM(messages_sent),0)::int AS sent,
                COALESCE(SUM(messages_received),0)::int AS received
         FROM wa_personal_stats WHERE tenant_id=$1::uuid AND date >= $2::date AND date < $3::date`,
        [tenantId, prevStart, prevEnd],
      ),
      query(
        `SELECT COUNT(DISTINCT COALESCE(m.remote_jid, m.lead_id::text))::int AS count
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id AND c.channel = 'personal_wa'
         WHERE m.tenant_id=$1::uuid AND m.created_at >= $2::timestamptz`,
        [tenantId, startTs],
      ),
      query(
        `SELECT COUNT(DISTINCT COALESCE(m.remote_jid, m.lead_id::text))::int AS count
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id AND c.channel = 'personal_wa'
         WHERE m.tenant_id=$1::uuid AND m.created_at >= $2::timestamptz AND m.created_at < $3::timestamptz`,
        [tenantId, prevStartTs, prevEndTs],
      ),
      query(
        `WITH conv_stats AS (
           SELECT m.conversation_id,
             COUNT(*) FILTER (WHERE m.sender='agent')    AS sent_cnt,
             COUNT(*) FILTER (WHERE m.sender='customer') AS recv_cnt
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id AND c.channel = 'personal_wa'
           WHERE m.tenant_id=$1::uuid AND m.created_at >= $2::timestamptz
           GROUP BY m.conversation_id
         )
         SELECT COUNT(*) FILTER (WHERE recv_cnt > 0)::int AS total_inbound,
                COUNT(*) FILTER (WHERE recv_cnt > 0 AND sent_cnt > 0)::int AS replied
         FROM conv_stats`,
        [tenantId, startTs],
      ),
    ]);

    const totalInbound = reply.rows[0]?.total_inbound ?? 0;
    const replied      = reply.rows[0]?.replied ?? 0;
    const replyRate    = totalInbound > 0 ? Math.round((replied / totalInbound) * 100) : 0;

    res.json({
      sent:      { value: cur.rows[0]?.sent ?? 0,          prev: prev.rows[0]?.sent ?? 0 },
      received:  { value: cur.rows[0]?.received ?? 0,      prev: prev.rows[0]?.received ?? 0 },
      contacts:  { value: curContacts.rows[0]?.count ?? 0, prev: prevContacts.rows[0]?.count ?? 0 },
      replyRate: { value: replyRate, totalInbound, replied },
    });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/whatsapp-personal/volume?period=week
router.get('/volume', async (req: AuthRequest, res: Response) => {
  const { period = 'week' } = req.query as { period?: string };
  const tenantId = req.user!.tenantId!;
  const { start } = periodBounds(period);
  try {
    const result = await query(
      `SELECT date::text,
              COALESCE(messages_sent,0)::int AS sent,
              COALESCE(messages_received,0)::int AS received
       FROM wa_personal_stats
       WHERE tenant_id=$1::uuid AND date >= $2::date ORDER BY date ASC`,
      [tenantId, start],
    );
    res.json(result.rows);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/whatsapp-personal/top-contacts?period=week&limit=5
router.get('/top-contacts', async (req: AuthRequest, res: Response) => {
  const { period = 'week', limit = '5' } = req.query as { period?: string; limit?: string };
  const tenantId = req.user!.tenantId!;
  const { start } = periodBounds(period);
  const startTs = start + 'T00:00:00Z';
  try {
    const result = await query(
      `SELECT
         COALESCE(l.name,  REGEXP_REPLACE(COALESCE(m.remote_jid,''), '@.*$', '')) AS contact_name,
         COALESCE(l.phone, REGEXP_REPLACE(COALESCE(m.remote_jid,''), '@.*$', '')) AS phone,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE m.sender='agent')::int    AS sent,
         COUNT(*) FILTER (WHERE m.sender='customer')::int AS received
       FROM messages m
       JOIN  conversations c ON c.id = m.conversation_id AND c.channel = 'personal_wa'
       LEFT JOIN leads l ON l.id = m.lead_id AND l.tenant_id = m.tenant_id AND l.is_deleted = FALSE
       WHERE m.tenant_id=$1::uuid AND m.created_at >= $2::timestamptz
       GROUP BY COALESCE(l.name,  REGEXP_REPLACE(COALESCE(m.remote_jid,''), '@.*$', '')),
                COALESCE(l.phone, REGEXP_REPLACE(COALESCE(m.remote_jid,''), '@.*$', ''))
       ORDER BY total DESC LIMIT $3`,
      [tenantId, startTs, parseInt(limit) || 5],
    );
    res.json(result.rows);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/whatsapp-personal/logs?period=week&direction=all&search=&limit=50&offset=0
router.get('/logs', async (req: AuthRequest, res: Response) => {
  const { period = 'week', direction = 'all', search = '', limit = '50', offset = '0' } =
    req.query as Record<string, string>;
  const tenantId = req.user!.tenantId!;
  const { start } = periodBounds(period);
  const startTs = start + 'T00:00:00Z';

  const baseParams: any[] = [tenantId, startTs];
  let where = `m.tenant_id=$1::uuid AND m.created_at >= $2::timestamptz AND c.channel='personal_wa'`;

  if (direction === 'sent')     where += ` AND m.sender='agent'`;
  else if (direction === 'received') where += ` AND m.sender='customer'`;

  if (search.trim()) {
    baseParams.push(`%${search.trim()}%`);
    const n = baseParams.length;
    where += ` AND (l.name ILIKE $${n} OR l.phone ILIKE $${n} OR m.remote_jid ILIKE $${n})`;
  }

  const dataParams = [...baseParams, parseInt(limit) || 50, parseInt(offset) || 0];
  const lIdx = dataParams.length - 1;
  const oIdx = dataParams.length;

  try {
    const [rows, countRes] = await Promise.all([
      query(
        `SELECT m.id, m.sender, m.body, m.created_at, m.wa_account, m.remote_jid, m.status, m.type, m.sent_by,
                COALESCE(l.name,  REGEXP_REPLACE(COALESCE(m.remote_jid,''), '@.*$', '')) AS contact_name,
                COALESCE(l.phone, REGEXP_REPLACE(COALESCE(m.remote_jid,''), '@.*$', '')) AS contact_phone
         FROM messages m
         JOIN  conversations c ON c.id = m.conversation_id
         LEFT JOIN leads l ON l.id = m.lead_id AND l.tenant_id = m.tenant_id AND l.is_deleted = FALSE
         WHERE ${where}
         ORDER BY m.created_at DESC LIMIT $${lIdx} OFFSET $${oIdx}`,
        dataParams,
      ),
      query(
        `SELECT COUNT(*)::int AS total
         FROM messages m
         JOIN  conversations c ON c.id = m.conversation_id
         LEFT JOIN leads l ON l.id = m.lead_id AND l.tenant_id = m.tenant_id AND l.is_deleted = FALSE
         WHERE ${where}`,
        baseParams,
      ),
    ]);
    res.json({ rows: rows.rows, total: countRes.rows[0]?.total ?? 0 });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/whatsapp-personal/settings
router.get('/settings', async (req: AuthRequest, res: Response) => {
  try {
    const res2 = await query(
      `SELECT settings->>'wa_auto_create_lead' AS wa_auto_create_lead FROM tenants WHERE id=$1::uuid`,
      [req.user!.tenantId],
    );
    res.json({ wa_auto_create_lead: res2.rows[0]?.wa_auto_create_lead === 'true' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/whatsapp-personal/settings
router.patch('/settings', async (req: AuthRequest, res: Response) => {
  const { wa_auto_create_lead } = req.body as { wa_auto_create_lead?: boolean };
  try {
    await query(
      `UPDATE tenants
       SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('wa_auto_create_lead', $1::text)
       WHERE id=$2::uuid`,
      [String(!!wa_auto_create_lead), req.user!.tenantId],
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

export default router;
