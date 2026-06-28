import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { query } from '../db';
import { AuthRequest } from '../middleware/auth';
import { requireDevice } from '../middleware/deviceAuth';
import { hasPermission } from '../middleware/permissions';
import { incrementUsage } from '../middleware/plan';
import { emitToTenant } from '../socket';
import { triggerWorkflows } from './workflows';
import { sendCallLoggedNotification } from '../utils/notifications';
import { normalizePhone } from '../utils/phone';
import { RECORDINGS_DIR } from '../utils/recordingDownloader';
import { cleanText } from '../utils/sanitize';

const router = Router();

// Recording uploads stored in memory then written to disk (50 MB cap for long calls)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Brute-force protection on the public pairing endpoint
const pairLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: process.env.NODE_ENV === 'production' ? 30 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many pairing attempts. Try again in 15 minutes.' },
});

// ── POST /api/mobile/pair (PUBLIC) ─────────────────────────────────────────────
// Staff enters the owner-generated code → device binds to that user and gets a
// long-lived device token. Atomic single-use redemption (race-safe).
router.post('/pair', pairLimiter, async (req: Request, res: Response) => {
  const { code, deviceLabel, platform, appVersion } = req.body as {
    code?: string; deviceLabel?: string; platform?: string; appVersion?: string;
  };
  if (!code || typeof code !== 'string') { res.status(400).json({ error: 'Pairing code required' }); return; }

  const prefix = code.substring(0, 8);
  try {
    const candidate = await query(
      `SELECT id, tenant_id, user_id, device_label, code_hash, expires_at, used
       FROM device_pairing_codes
       WHERE code_prefix = $1 AND used = FALSE
       ORDER BY created_at DESC
       LIMIT 1`,
      [prefix]
    );
    const row = candidate.rows[0];
    if (!row) { res.status(401).json({ error: 'Invalid or expired pairing code' }); return; }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      res.status(401).json({ error: 'Pairing code expired' }); return;
    }
    const match = await bcrypt.compare(code, row.code_hash);
    if (!match) { res.status(401).json({ error: 'Invalid or expired pairing code' }); return; }

    // Atomic single-use: only one device wins this code
    const claimed = await query(
      `UPDATE device_pairing_codes SET used = TRUE, used_at = NOW()
       WHERE id = $1 AND used = FALSE
       RETURNING id`,
      [row.id]
    );
    if (!claimed.rows[0]) { res.status(401).json({ error: 'Pairing code already used' }); return; }

    // Issue device token (same model as refresh tokens: random + bcrypt hash + prefix)
    const token = crypto.randomBytes(40).toString('hex');
    const tokenHash = await bcrypt.hash(token, 10);
    const tokenPrefix = token.substring(0, 16);

    const inserted = await query(
      `INSERT INTO mobile_devices
         (tenant_id, user_id, device_label, device_token_hash, device_token_prefix, platform, app_version, last_seen_at)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,NOW())
       RETURNING id`,
      [row.tenant_id, row.user_id, deviceLabel ?? row.device_label ?? null, tokenHash, tokenPrefix,
       platform ?? 'android', appVersion ?? null]
    );

    // Identity + permissions so the app can gate its own UI
    const ctx = await query(
      `SELECT u.id, u.name, u.email, u.role, t.id AS tenant_id, t.name AS tenant_name
       FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1::uuid`,
      [row.user_id]
    );
    const permRow = await query(
      `SELECT permissions FROM user_permissions WHERE user_id = $1::uuid`,
      [row.user_id]
    );
    const u = ctx.rows[0];
    const isPrivileged = u.role === 'owner' || u.role === 'super_admin';

    res.json({
      deviceToken: token,
      deviceId: inserted.rows[0].id,
      user: { id: u.id, name: u.name, email: u.email, role: u.role },
      tenant: { id: u.tenant_id, name: u.tenant_name },
      permissions: isPrivileged ? { all: true } : (permRow.rows[0]?.permissions ?? {}),
    });
  } catch (err: any) {
    console.error('[mobile/pair]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/mobile/login (PUBLIC) ────────────────────────────────────────────
// Agent signs in with CRM email + password → device binds to that user/tenant and
// receives a long-lived device token. Replaces pairing codes (tenant + user come
// unambiguously from the login).
router.post('/login', pairLimiter, async (req: Request, res: Response) => {
  const { email, password, deviceLabel, platform, appVersion } = req.body as {
    email?: string; password?: string; deviceLabel?: string; platform?: string; appVersion?: string;
  };
  if (!email || !password) { res.status(400).json({ error: 'Email and password required' }); return; }

  try {
    const u = await query(
      `SELECT id, tenant_id, role, password_hash, is_active, locked_until
       FROM users WHERE lower(email)=lower($1) LIMIT 1`,
      [email]
    );
    const user = u.rows[0];
    const fail = () => res.status(401).json({ error: 'Invalid email or password' });
    if (!user || !user.is_active || !user.password_hash) { fail(); return; }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      res.status(423).json({ error: 'Account temporarily locked. Try again later.' }); return;
    }
    if (!user.tenant_id) { res.status(403).json({ error: 'This account cannot use the mobile app' }); return; }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) { fail(); return; }

    // Issue device token (same model as refresh tokens)
    const token = crypto.randomBytes(40).toString('hex');
    const tokenHash = await bcrypt.hash(token, 10);
    const tokenPrefix = token.substring(0, 16);
    const inserted = await query(
      `INSERT INTO mobile_devices
         (tenant_id, user_id, device_label, device_token_hash, device_token_prefix, platform, app_version, last_seen_at)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,NOW())
       RETURNING id`,
      [user.tenant_id, user.id, deviceLabel ?? null, tokenHash, tokenPrefix, platform ?? 'android', appVersion ?? null]
    );

    const ctx = await query(
      `SELECT u.id, u.name, u.email, u.role, u.phone, t.id AS tenant_id, t.name AS tenant_name
       FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1::uuid`,
      [user.id]
    );
    const permRow = await query(`SELECT permissions FROM user_permissions WHERE user_id = $1::uuid`, [user.id]);
    const c = ctx.rows[0];
    const isPrivileged = c.role === 'owner' || c.role === 'super_admin';

    res.json({
      deviceToken: token,
      deviceId: inserted.rows[0].id,
      user: { id: c.id, name: c.name, email: c.email, role: c.role, phone: c.phone ?? null },
      tenant: { id: c.tenant_id, name: c.tenant_name },
      permissions: isPrivileged ? { all: true } : (permRow.rows[0]?.permissions ?? {}),
    });
  } catch (err: any) {
    console.error('[mobile/login]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/mobile/register-number (PUBLIC) ──────────────────────────────────
// The app has NO login. It verifies the SIM number, then registers: the backend
// matches that number to a dashboard OTP-verified registration and binds the device
// to that tenant/user. Recording is then enabled for this number's calls.
router.post('/register-number', pairLimiter, async (req: Request, res: Response) => {
  const { phone, method, sims, deviceLabel, platform, appVersion } = req.body as {
    phone?: string; method?: string; sims?: unknown; deviceLabel?: string; platform?: string; appVersion?: string;
  };
  if (!phone) { res.status(400).json({ error: 'Phone number required' }); return; }
  const normalized = normalizePhone(phone);

  // Skipped verification → never link / never sync, regardless of CRM status.
  if (method === 'skip') { res.json({ linked: false }); return; }

  try {
    const v = await query(
      `SELECT v.tenant_id, v.user_id, u.name, u.email, u.role, u.is_active AS user_active,
              t.name AS tenant_name, t.is_active AS tenant_active
       FROM dialer_number_verifications v
       JOIN users u   ON u.id = v.user_id
       JOIN tenants t ON t.id = v.tenant_id
       WHERE v.phone_number=$1 AND v.verified=TRUE
       ORDER BY v.verified_at DESC LIMIT 1`,
      [normalized]
    );
    const row = v.rows[0];
    // Number not (yet) verified in any CRM → the app still works locally. No token
    // is issued and nothing syncs until an admin verifies this number in the dashboard.
    if (!row || !row.tenant_active || !row.user_active) {
      res.json({ linked: false });
      return;
    }

    const token = crypto.randomBytes(40).toString('hex');
    const tokenHash = await bcrypt.hash(token, 10);
    const tokenPrefix = token.substring(0, 16);
    const appVerified = method === 'call_log' || method === 'call';

    const inserted = await query(
      `INSERT INTO mobile_devices
         (tenant_id, user_id, device_label, device_token_hash, device_token_prefix, platform, app_version,
          phone_number, phone_verified, verify_method, sim_info, last_seen_at)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW())
       RETURNING id`,
      [row.tenant_id, row.user_id, deviceLabel ?? normalized, tokenHash, tokenPrefix, platform ?? 'android',
       appVersion ?? null, normalized, appVerified, method ?? 'skip', JSON.stringify(sims ?? null)]
    );

    await query(
      `UPDATE users SET phone=COALESCE(phone,$2) WHERE id=$1::uuid`,
      [row.user_id, normalized]
    );

    // Record this (primary) number against the device for dual-SIM tracking.
    const simSlot = (req.body as any)?.simSlot ?? null;
    await query(
      `INSERT INTO mobile_device_numbers (device_id, tenant_id, phone_number, sim_slot, verified, verify_method)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6)
       ON CONFLICT (device_id, phone_number) DO NOTHING`,
      [inserted.rows[0].id, row.tenant_id, normalized, simSlot, appVerified, method ?? 'skip']
    );

    const permRow = await query(`SELECT permissions FROM user_permissions WHERE user_id = $1::uuid`, [row.user_id]);
    const isPrivileged = row.role === 'owner' || row.role === 'super_admin';

    res.json({
      deviceToken: token,
      deviceId: inserted.rows[0].id,
      user: { id: row.user_id, name: row.name, email: row.email, role: row.role },
      tenant: { id: row.tenant_id, name: row.tenant_name },
      permissions: isPrivileged ? { all: true } : (permRow.rows[0]?.permissions ?? {}),
      phone: normalized,
      linked: true,
      recordingRequired: true,
    });
  } catch (err: any) {
    console.error('[mobile/register-number]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Everything below requires a valid device token ─────────────────────────────
router.use(requireDevice);

// POST /api/mobile/calls/by-key/recording — attach a recording to a recently-logged
// call matched by phone + start time (used by the in-app recorder; avoids needing the
// server call id on the device).
router.post('/calls/by-key/recording', upload.single('recording'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const phone = normalizePhone((req.body?.phone ?? '').toString());
  const startedAtMs = parseInt((req.body?.startedAt ?? '0').toString(), 10);
  if (!req.file || !phone) { res.status(400).json({ error: 'recording file and phone required' }); return; }

  try {
    // Match the closest call_log row for this tenant by phone digit-suffix within ±5 min.
    // Suffix match tolerates +91 / spacing / formatting differences between sources.
    const digits = phone.replace(/\D/g, '');
    const suffix = digits.length > 9 ? digits.slice(-9) : digits;
    const startIso = startedAtMs > 0 ? new Date(startedAtMs).toISOString() : null;
    const match = await query(
      `SELECT id FROM call_logs
       WHERE tenant_id=$1::uuid
         AND regexp_replace(COALESCE(caller_phone,''), '\\D', '', 'g') LIKE '%' || $2
         AND ($3::timestamptz IS NULL OR ABS(EXTRACT(EPOCH FROM (COALESCE(started_at, created_at) - $3::timestamptz))) < 300)
       ORDER BY ABS(EXTRACT(EPOCH FROM (COALESCE(started_at, created_at) - COALESCE($3::timestamptz, NOW())))) ASC
       LIMIT 1`,
      [tenantId, suffix, startIso]
    );
    const callId = match.rows[0]?.id;
    if (!callId) { res.status(404).json({ error: 'No matching call to attach recording' }); return; }

    const mime = req.file.mimetype || '';
    const ext = mime.includes('wav') ? '.wav'
      : mime.includes('m4a') || mime.includes('mp4') || mime.includes('aac') ? '.m4a'
      : mime.includes('ogg') ? '.ogg' : '.mp3';
    const relPath = `${tenantId}/${callId}${ext}`;
    const fullPath = path.join(RECORDINGS_DIR, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, req.file.buffer);
    await query(`UPDATE call_logs SET recording_path=$1, recording_downloaded=TRUE WHERE id=$2::uuid`, [relPath, callId]);
    res.json({ ok: true, callId });
  } catch (err: any) {
    console.error('[mobile/by-key/recording]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/mobile/add-number — attach an ADDITIONAL SIM number to this device
// (dual-SIM). The number must be OTP-verified in the dashboard for this tenant.
router.post('/add-number', async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { phone, method, simSlot } = req.body as { phone?: string; method?: string; simSlot?: number };
  if (!phone) { res.status(400).json({ error: 'Phone number required' }); return; }
  const normalized = normalizePhone(phone);

  try {
    const v = await query(
      `SELECT id FROM dialer_number_verifications
       WHERE tenant_id=$1::uuid AND phone_number=$2 AND verified=TRUE LIMIT 1`,
      [tenantId, normalized]
    );
    if (!v.rows[0]) {
      res.status(403).json({
        code: 'not_verified',
        error: 'This number is not verified in the dashboard yet. Ask your admin to verify it under Settings → Dialer Device Pair.',
      });
      return;
    }
    const appVerified = method === 'call_log' || method === 'call';
    await query(
      `INSERT INTO mobile_device_numbers (device_id, tenant_id, phone_number, sim_slot, verified, verify_method)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6)
       ON CONFLICT (device_id, phone_number) DO UPDATE SET verified=$5, verify_method=$6, sim_slot=$4`,
      [req.deviceId, tenantId, normalized, simSlot ?? null, appVerified, method ?? 'skip']
    );
    res.json({ ok: true, phone: normalized, verified: appVerified });
  } catch (err: any) {
    console.error('[mobile/add-number]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/mobile/verify-number — attach + verify the SIM phone number to this device.
// method: 'call_log' | 'call' | 'skip'. Also stores the number on the user record.
router.post('/verify-number', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const { phone, method, sims } = req.body as {
    phone?: string; method?: string; sims?: unknown;
  };
  if (!phone) { res.status(400).json({ error: 'Phone number required' }); return; }

  const normalized = normalizePhone(phone);
  const verified = method === 'call_log' || method === 'call';

  try {
    await query(
      `UPDATE mobile_devices
       SET phone_number=$2, phone_verified=$3, verify_method=$4, sim_info=$5::jsonb
       WHERE id=$1`,
      [req.deviceId, normalized, verified, method ?? 'skip', JSON.stringify(sims ?? null)]
    );
    // Keep the user's phone in sync so call matching + staff display use it.
    await query(
      `UPDATE users SET phone=COALESCE(phone,$2) WHERE id=$1::uuid AND tenant_id=$3::uuid`,
      [userId, normalized, tenantId]
    );
    res.json({ ok: true, phone: normalized, verified });
  } catch (err: any) {
    console.error('[mobile/verify-number]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/mobile/me — refresh identity + permissions on app launch
router.get('/me', async (req: AuthRequest, res: Response) => {
  const { userId, role, tenantId } = req.user!;
  try {
    const ctx = await query(
      `SELECT u.id, u.name, u.email, u.role, t.id AS tenant_id, t.name AS tenant_name
       FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1::uuid`,
      [userId]
    );
    const permRow = await query(`SELECT permissions FROM user_permissions WHERE user_id = $1::uuid`, [userId]);
    const u = ctx.rows[0];
    const isPrivileged = role === 'owner' || role === 'super_admin';
    res.json({
      user: { id: u.id, name: u.name, email: u.email, role: u.role },
      tenant: { id: u.tenant_id, name: u.tenant_name },
      permissions: isPrivileged ? { all: true } : (permRow.rows[0]?.permissions ?? {}),
    });
  } catch (err: any) {
    console.error('[mobile/me]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/mobile/push-token — register/refresh FCM token for this device
router.post('/push-token', async (req: AuthRequest, res: Response) => {
  const { pushToken } = req.body as { pushToken?: string };
  try {
    await query(`UPDATE mobile_devices SET push_token = $2 WHERE id = $1`, [req.deviceId, pushToken ?? null]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Call ingest helpers ────────────────────────────────────────────────────────
function normalizeDirection(raw: any): 'INBOUND' | 'OUTBOUND' {
  const v = String(raw ?? '').toUpperCase();
  if (v === 'OUTBOUND' || v === 'OUTGOING' || v === 'OUT') return 'OUTBOUND';
  return 'INBOUND';
}
function normalizeOutcome(raw: any, durationSeconds: number): string {
  const v = String(raw ?? '').toUpperCase();
  if (['ANSWERED', 'MISSED', 'REJECTED', 'BUSY', 'NO_ANSWER'].includes(v)) return v;
  if (['INCOMING', 'OUTGOING'].includes(v)) return durationSeconds > 0 ? 'ANSWERED' : 'MISSED';
  return durationSeconds > 0 ? 'ANSWERED' : 'MISSED';
}

interface MobileCallInput {
  clientCallId?: string;
  phone?: string;
  direction?: string;
  outcome?: string;
  durationSeconds?: number;
  startedAt?: string;
  endedAt?: string;
  disposition?: string;
  notes?: string;
}

async function ingestOneCall(
  call: MobileCallInput,
  tenantId: string,
  staffUserId: string,
  staffName: string | null,
  deviceId: string | undefined,
): Promise<{ clientCallId: string | null; id: string | null; status: 'inserted' | 'duplicate' | 'error'; error?: string }> {
  const clientCallId = call.clientCallId ?? null;
  try {
    const phone = call.phone ?? null;
    const direction = normalizeDirection(call.direction);
    const duration = Number(call.durationSeconds ?? 0) || 0;
    const outcome = normalizeOutcome(call.outcome, duration);

    // Match caller/callee phone to a lead (normalized + raw)
    let leadId: string | null = null;
    let leadName: string | null = null;
    let isUnknown = false;
    if (phone) {
      const normalized = normalizePhone(phone);
      const leadMatch = await query(
        `SELECT id, name FROM leads
         WHERE tenant_id=$1::uuid AND is_deleted=FALSE AND (phone = $2 OR phone = $3)
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, phone, normalized]
      );
      if (leadMatch.rows[0]) { leadId = leadMatch.rows[0].id; leadName = leadMatch.rows[0].name ?? null; }
      else isUnknown = true;
    }

    const insertResult = await query(
      `INSERT INTO call_logs
         (tenant_id, lead_id, direction, outcome, caller_phone,
          duration_seconds, started_at, ended_at, staff_name, staff_user_id,
          source, device_id, client_call_id, disposition, notes, is_unknown)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,'mobile',$11,$12,$13,$14,$15)
       ON CONFLICT (tenant_id, client_call_id) WHERE client_call_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        tenantId, leadId, direction, outcome, phone,
        duration, call.startedAt ?? null, call.endedAt ?? null, staffName, staffUserId,
        deviceId ?? null, clientCallId, call.disposition ?? null, call.notes ?? null, isUnknown,
      ]
    );

    if (!insertResult.rows[0]) return { clientCallId, id: null, status: 'duplicate' };
    const callLogId = insertResult.rows[0].id;

    // Real-time event (same field set the web CallsPage listener expects)
    emitToTenant(tenantId, 'call:logged', {
      id: callLogId, leadId, isUnknown, direction, outcome,
      callerPhone: phone, duration, staffName, startedAt: call.startedAt ?? null,
    });

    // In-app notification
    sendCallLoggedNotification(tenantId, {
      id: callLogId, leadId, leadName, isUnknown, direction, outcome,
      callerPhone: phone, duration, staffName, staffUserId,
    }).catch(() => null);

    // Lead timeline activity — store call_log_id in detail for recording playback
    if (leadId) {
      const durTxt = duration > 0 ? ` (${Math.round(duration / 60)}m ${duration % 60}s)` : '';
      query(
        `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
         VALUES ($1::uuid,$2::uuid,'call',$3,$4,$5::uuid)`,
        [leadId, tenantId, `${direction === 'OUTBOUND' ? 'Outgoing' : 'Incoming'} call - ${outcome}${durTxt}`,
         callLogId, staffUserId]
      ).catch(() => null);
    }

    // Fire automation triggers for matched leads
    if (!isUnknown && leadId) {
      const triggerKey = outcome === 'ANSWERED' ? 'call_answered' : outcome === 'MISSED' ? 'call_missed' : null;
      if (triggerKey) {
        setImmediate(() => triggerWorkflows(
          triggerKey, { id: leadId!, name: leadName ?? '' }, tenantId, staffUserId,
          { triggerContext: { callDirection: direction } as any }
        ).catch(() => null));
      }
    }

    return { clientCallId, id: callLogId, status: 'inserted' };
  } catch (err: any) {
    console.error('[mobile/calls ingest]', err.message);
    return { clientCallId, id: null, status: 'error', error: err.message };
  }
}

// POST /api/mobile/calls — single object OR array (offline batch, cap 200)
router.post('/calls', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const body = req.body;
  const calls: MobileCallInput[] = Array.isArray(body) ? body : Array.isArray(body?.calls) ? body.calls : [body];
  if (!calls.length) { res.status(400).json({ error: 'No calls provided' }); return; }
  if (calls.length > 200) { res.status(413).json({ error: 'Batch too large (max 200)' }); return; }

  try {
    const staff = await query(`SELECT name FROM users WHERE id=$1::uuid`, [userId]);
    const staffName = staff.rows[0]?.name ?? null;

    const results = [];
    let inserted = 0, duplicates = 0, errors = 0;
    for (const call of calls) {
      const r = await ingestOneCall(call, tenantId!, userId, staffName, req.deviceId);
      if (r.status === 'inserted') inserted++;
      else if (r.status === 'duplicate') duplicates++;
      else errors++;
      results.push(r);
    }
    res.json({ inserted, duplicates, errors, results });
  } catch (err: any) {
    console.error('[mobile/calls]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/mobile/calls/by-key/note — add/update note + tag (disposition) for a
// call matched by phone + start time. The app calls this when the agent writes a
// note after the call (the call itself was already auto-synced when it ended).
router.post('/calls/by-key/note', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const phone = normalizePhone((req.body?.phone ?? '').toString());
  const startedAtMs = parseInt((req.body?.startedAt ?? '0').toString(), 10);
  const note = cleanText(req.body?.note ?? '');
  const tag = req.body?.tag != null ? cleanText(req.body.tag) : null;
  if (!phone) { res.status(400).json({ error: 'phone required' }); return; }

  try {
    const digits = phone.replace(/\D/g, '');
    const suffix = digits.length > 9 ? digits.slice(-9) : digits;
    const startIso = startedAtMs > 0 ? new Date(startedAtMs).toISOString() : null;
    const match = await query(
      `SELECT id, lead_id FROM call_logs
       WHERE tenant_id=$1::uuid
         AND regexp_replace(COALESCE(caller_phone,''), '\\D', '', 'g') LIKE '%' || $2
         AND ($3::timestamptz IS NULL OR ABS(EXTRACT(EPOCH FROM (COALESCE(started_at, created_at) - $3::timestamptz))) < 300)
       ORDER BY ABS(EXTRACT(EPOCH FROM (COALESCE(started_at, created_at) - COALESCE($3::timestamptz, NOW())))) ASC
       LIMIT 1`,
      [tenantId, suffix, startIso]
    );
    const row = match.rows[0];
    if (!row) { res.status(404).json({ error: 'No matching call to attach the note' }); return; }

    await query(
      `UPDATE call_logs SET notes=$2, disposition=COALESCE($3, disposition) WHERE id=$1::uuid`,
      [row.id, note, tag]
    );
    // Mirror the note onto the lead's timeline if the call is linked to a lead.
    if (row.lead_id && note) {
      query(
        `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
         VALUES ($1::uuid,$2::uuid,'note','Call note',$3,$4::uuid)`,
        [row.lead_id, tenantId, note, userId]
      ).catch(() => null);
    }
    res.json({ ok: true, callId: row.id });
  } catch (err: any) {
    console.error('[mobile/by-key/note]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/mobile/calls/:callId/recording — upload audio for a logged call
router.post('/calls/:callId/recording', upload.single('recording'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { callId } = req.params;
  if (!req.file) { res.status(400).json({ error: 'No recording file' }); return; }

  try {
    const call = await query(
      `SELECT id FROM call_logs WHERE id=$1::uuid AND tenant_id=$2::uuid`,
      [callId, tenantId]
    );
    if (!call.rows[0]) { res.status(404).json({ error: 'Call not found' }); return; }

    const mime = req.file.mimetype || '';
    const ext = mime.includes('wav') ? '.wav'
      : mime.includes('m4a') || mime.includes('mp4') || mime.includes('aac') ? '.m4a'
      : mime.includes('ogg') ? '.ogg'
      : '.mp3';
    const relPath = `${tenantId}/${callId}${ext}`;
    const fullPath = path.join(RECORDINGS_DIR, relPath);

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, req.file.buffer);

    await query(
      `UPDATE call_logs SET recording_path=$1, recording_downloaded=TRUE WHERE id=$2::uuid`,
      [relPath, callId]
    );
    res.json({ ok: true, recordingPath: relPath });
  } catch (err: any) {
    console.error('[mobile/recording]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/mobile/calls/:callId — set disposition / notes after a call
router.patch('/calls/:callId', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const { callId } = req.params;
  const { disposition, notes } = req.body as { disposition?: string; notes?: string };

  try {
    const result = await query(
      `UPDATE call_logs
       SET disposition = COALESCE($3, disposition), notes = COALESCE($4, notes)
       WHERE id=$1::uuid AND tenant_id=$2::uuid AND staff_user_id=$5::uuid
       RETURNING id, lead_id`,
      [callId, tenantId, disposition ?? null, notes ?? null, userId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Call not found' }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[mobile/calls patch]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/mobile/me/stats?date_from&date_to — agent home screen metrics
router.get('/me/stats', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const { date_from, date_to } = req.query as Record<string, string>;
  const params: any[] = [tenantId, userId];
  const conds = ['tenant_id=$1::uuid', 'staff_user_id=$2::uuid'];
  if (date_from) { params.push(date_from); conds.push(`COALESCE(started_at, created_at) >= $${params.length}::timestamptz`); }
  if (date_to)   { params.push(date_to);   conds.push(`COALESCE(started_at, created_at) <= $${params.length}::timestamptz`); }
  const where = conds.join(' AND ');

  try {
    const r = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE outcome='ANSWERED')::int AS connected,
         COUNT(*) FILTER (WHERE outcome<>'ANSWERED')::int AS missed,
         COALESCE(SUM(duration_seconds),0)::int AS talk_time_seconds,
         COUNT(DISTINCT lead_id) FILTER (WHERE lead_id IS NOT NULL)::int AS unique_leads
       FROM call_logs WHERE ${where}`,
      params
    );
    res.json(r.rows[0]);
  } catch (err: any) {
    console.error('[mobile/me/stats]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/mobile/pipelines — pipelines with their stages + lead counts (per pipeline
// and per stage), for the CRM Leads filter and the lead-details pipeline/stage mover.
router.get('/pipelines', async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  try {
    const pls = await query(
      'SELECT id, name FROM pipelines WHERE tenant_id=$1::uuid ORDER BY created_at',
      [tenantId]
    );
    const stages = await query(
      `SELECT id, pipeline_id, name, stage_order, color
       FROM pipeline_stages WHERE tenant_id=$1::uuid ORDER BY stage_order`,
      [tenantId]
    );
    const counts = await query(
      `SELECT pipeline_id, stage_id, COUNT(*)::int AS n
       FROM leads WHERE tenant_id=$1::uuid AND is_deleted=FALSE
       GROUP BY pipeline_id, stage_id`,
      [tenantId]
    );
    const stageCount: Record<string, number> = {};
    const pipeCount: Record<string, number> = {};
    for (const r of counts.rows) {
      if (r.stage_id) stageCount[r.stage_id] = (stageCount[r.stage_id] || 0) + r.n;
      if (r.pipeline_id) pipeCount[r.pipeline_id] = (pipeCount[r.pipeline_id] || 0) + r.n;
    }
    const byPipe: Record<string, any[]> = {};
    for (const s of stages.rows) {
      (byPipe[s.pipeline_id] ||= []).push({ id: s.id, name: s.name, color: s.color, count: stageCount[s.id] || 0 });
    }
    const pipelines = pls.rows.map((p: any) => ({
      id: p.id, name: p.name, leadCount: pipeCount[p.id] || 0, stages: byPipe[p.id] || [],
    }));
    res.json({ pipelines });
  } catch (err: any) {
    console.error('[mobile/pipelines]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/mobile/leads — scoped lead list for the dialer (only_assigned aware).
// Optional filters: pipelineId, stageId, search.
router.get('/leads', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const { search, limit = '50', offset = '0', pipelineId, stageId } = req.query as Record<string, string>;

  try {
    let viewAll = role === 'super_admin';
    if (!viewAll) {
      const isOwner = (await query('SELECT is_owner FROM users WHERE id=$1', [userId])).rows[0]?.is_owner === true;
      if (isOwner) viewAll = true;
      else if (await hasPermission(userId, 'leads:only_assigned', tenantId)) viewAll = false;
      else viewAll = await hasPermission(userId, 'leads:view_all', tenantId);
    }

    const pageSize = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const off = Math.max(parseInt(offset) || 0, 0);

    const params: any[] = [tenantId];
    const conds = ['l.tenant_id=$1::uuid', 'l.is_deleted=FALSE'];
    if (!viewAll) { params.push(userId); conds.push(`l.assigned_to=$${params.length}::uuid`); }
    if (pipelineId) { params.push(pipelineId); conds.push(`l.pipeline_id=$${params.length}::uuid`); }
    if (stageId) { params.push(stageId); conds.push(`l.stage_id=$${params.length}::uuid`); }
    if (search) { params.push(`%${search}%`); conds.push(`(l.name ILIKE $${params.length} OR l.phone ILIKE $${params.length})`); }
    // Fetch one extra row to detect whether more pages exist.
    params.push(pageSize + 1); const limIdx = params.length;
    params.push(off); const offIdx = params.length;

    const result = await query(
      `SELECT l.id, l.name, l.phone, l.email, l.source, l.assigned_to,
              l.pipeline_id, l.stage_id,
              u.name AS assigned_name, s.name AS stage, p.name AS pipeline
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       LEFT JOIN pipeline_stages s ON s.id = l.stage_id
       LEFT JOIN pipelines p ON p.id = l.pipeline_id
       WHERE ${conds.join(' AND ')}
       ORDER BY l.created_at DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      params
    );
    const rows = result.rows;
    const hasMore = rows.length > pageSize;
    res.json({ leads: hasMore ? rows.slice(0, pageSize) : rows, hasMore, offset: off, limit: pageSize });
  } catch (err: any) {
    console.error('[mobile/leads]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/mobile/leads/lookup?phone= — find an existing lead by phone (for the
// post-call screen). Returns the lead with pipeline/stage + recent notes, or found:false.
router.get('/leads/lookup', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const phoneRaw = (req.query.phone ?? '').toString().trim();
  if (!phoneRaw) { res.status(400).json({ error: 'phone required' }); return; }
  const norm = normalizePhone(phoneRaw);
  try {
    // Respect only_assigned permission
    let viewAll = role === 'super_admin';
    if (!viewAll) {
      const isOwner = (await query('SELECT is_owner FROM users WHERE id=$1', [userId])).rows[0]?.is_owner === true;
      if (isOwner) viewAll = true;
      else if (await hasPermission(userId, 'leads:only_assigned', tenantId)) viewAll = false;
      else viewAll = true;
    }

    const params: any[] = [tenantId, phoneRaw, norm];
    let assignedFilter = '';
    if (!viewAll) { params.push(userId); assignedFilter = ` AND l.assigned_to=$${params.length}::uuid`; }

    const r = await query(
      `SELECT l.id, l.name, l.phone, l.email, l.source, l.notes,
              l.pipeline_id, l.stage_id, p.name AS pipeline, s.name AS stage,
              l.assigned_to, u.name AS assigned_name
       FROM leads l
       LEFT JOIN pipelines p ON p.id = l.pipeline_id
       LEFT JOIN pipeline_stages s ON s.id = l.stage_id
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.tenant_id=$1::uuid AND l.is_deleted=FALSE AND (l.phone=$2 OR l.phone=$3)${assignedFilter}
       ORDER BY l.created_at DESC LIMIT 1`,
      params
    );
    const lead = r.rows[0];
    if (!lead) { res.json({ found: false }); return; }
    const notes = await query(
      `SELECT title, detail, created_at FROM lead_activities
       WHERE lead_id=$1 AND type='note' ORDER BY created_at DESC LIMIT 10`,
      [lead.id]
    ).catch(() => ({ rows: [] as any[] }));
    res.json({ found: true, lead, notes: notes.rows });
  } catch (err: any) {
    console.error('[mobile/leads/lookup]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/mobile/followups — follow-ups ASSIGNED TO this device's staff user.
// (The device is bound to a staff via their verified number, so req.user.userId is
// that staff; we return the follow-ups assigned to them.) ?status=pending|completed|all
router.get('/followups', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const status = (req.query.status ?? 'pending').toString();
  try {
    const conds = ['f.tenant_id=$1::uuid', 'f.assigned_to=$2::uuid', 'l.is_deleted=FALSE'];
    if (status === 'pending') conds.push('f.completed=FALSE');
    else if (status === 'completed') conds.push('f.completed=TRUE');
    const r = await query(
      `SELECT f.id, f.title, f.description, f.due_at, f.completed, f.completed_at,
              f.lead_id, l.name AS lead_name, l.phone AS lead_phone,
              p.name AS pipeline, s.name AS stage
       FROM lead_followups f
       JOIN leads l ON l.id = f.lead_id
       LEFT JOIN pipelines p ON p.id = l.pipeline_id
       LEFT JOIN pipeline_stages s ON s.id = l.stage_id
       WHERE ${conds.join(' AND ')}
       ORDER BY f.completed ASC, f.due_at ASC
       LIMIT 300`,
      [tenantId, userId]
    );
    res.json({ followups: r.rows });
  } catch (err: any) {
    console.error('[mobile/followups]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/mobile/followups/:id/complete — mark a follow-up done (or undo). Body: { completed? }
router.post('/followups/:id/complete', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const id = req.params.id;
  const completed = req.body?.completed !== false; // default true
  try {
    const r = await query(
      `UPDATE lead_followups
       SET completed=$1, completed_at=CASE WHEN $1 THEN NOW() ELSE NULL END
       WHERE id=$2::uuid AND tenant_id=$3::uuid AND assigned_to=$4::uuid
       RETURNING id`,
      [completed, id, tenantId, userId]
    );
    if (!r.rows[0]) { res.status(404).json({ error: 'Follow-up not found' }); return; }
    res.json({ ok: true, completed });
  } catch (err: any) {
    console.error('[mobile/followups/complete]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/mobile/calls/:id/recording — stream a call recording (device auth).
router.get('/calls/:id/recording', async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const id = req.params.id;
  try {
    const r = await query(
      'SELECT recording_path, recording_url FROM call_logs WHERE id=$1::uuid AND tenant_id=$2::uuid',
      [id, tenantId]
    );
    const row = r.rows[0];
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    if (row.recording_path) {
      const filePath = path.join(RECORDINGS_DIR, row.recording_path);
      if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'Recording file missing' }); return; }
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.wav' ? 'audio/wav'
        : ext === '.ogg' ? 'audio/ogg' : ext === '.amr' ? 'audio/amr'
        : ext === '.3gp' ? 'audio/3gpp' : 'audio/mp4';
      const stat = fs.statSync(filePath);
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Accept-Ranges', 'bytes');
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    if (row.recording_url) { res.redirect(302, row.recording_url); return; }
    res.status(404).json({ error: 'No recording' });
  } catch (err: any) {
    console.error('[mobile/calls/recording]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/mobile/staff — active users in the tenant (for the assign-staff picker).
router.get('/staff', async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  try {
    const r = await query(
      `SELECT id, name, email FROM users
       WHERE tenant_id=$1::uuid AND is_active=TRUE
       ORDER BY is_owner DESC NULLS LAST, name ASC`,
      [tenantId]
    );
    res.json({ staff: r.rows });
  } catch (err: any) {
    console.error('[mobile/staff]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/mobile/leads/:id/assign — reassign a lead. Gated by leads:assign (or owner).
// Body: { assignedTo }  (null/'' = unassign)
router.post('/leads/:id/assign', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const id = req.params.id;
  const assignedTo = (req.body?.assignedTo || null) as string | null;
  try {
    let canAssign = role === 'super_admin';
    if (!canAssign) {
      const isOwner = (await query('SELECT is_owner FROM users WHERE id=$1', [userId])).rows[0]?.is_owner === true;
      canAssign = isOwner || await hasPermission(userId, 'leads:assign', tenantId);
    }
    if (!canAssign) { res.status(403).json({ error: 'You do not have permission to assign leads' }); return; }

    const owns = await query('SELECT id FROM leads WHERE id=$1::uuid AND tenant_id=$2::uuid AND is_deleted=FALSE', [id, tenantId]);
    if (!owns.rows[0]) { res.status(404).json({ error: 'Lead not found' }); return; }

    if (assignedTo) {
      const u = await query('SELECT id FROM users WHERE id=$1::uuid AND tenant_id=$2::uuid AND is_active=TRUE', [assignedTo, tenantId]);
      if (!u.rows[0]) { res.status(400).json({ error: 'Staff not found in your organization' }); return; }
    }

    await query('UPDATE leads SET assigned_to=$1, updated_at=NOW() WHERE id=$2::uuid AND tenant_id=$3::uuid', [assignedTo, id, tenantId]);
    await query(
      `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
       VALUES ($1,$2,'assignment','Lead reassigned from mobile dialer',$3)`,
      [id, tenantId, userId]
    ).catch(() => null);

    const updated = await query(
      `SELECT l.id, l.assigned_to, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id=l.assigned_to WHERE l.id=$1`,
      [id]
    );
    emitToTenant(tenantId!, 'lead:updated', updated.rows[0]);
    res.json({ ok: true, lead: updated.rows[0] });
  } catch (err: any) {
    console.error('[mobile/leads/assign]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/mobile/leads/:id/details — full lead detail (mirrors the CRM Lead Details
// panel): lead fields + tags + custom fields + activity timeline + this lead's calls.
router.get('/leads/:id/details', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const id = req.params.id;
  try {
    // Respect only_assigned permission
    let viewAll = role === 'super_admin';
    if (!viewAll) {
      const isOwner = (await query('SELECT is_owner FROM users WHERE id=$1', [userId])).rows[0]?.is_owner === true;
      if (isOwner) viewAll = true;
      else if (await hasPermission(userId, 'leads:only_assigned', tenantId)) viewAll = false;
      else viewAll = true;
    }

    const params: any[] = [id, tenantId];
    let assignedFilter = '';
    if (!viewAll) { params.push(userId); assignedFilter = ` AND l.assigned_to=$${params.length}::uuid`; }

    const r = await query(
      `SELECT l.id, l.name, l.phone, l.email, l.source, l.notes, l.deal_value,
              l.pipeline_id, l.stage_id, l.assigned_to, l.custom_fields,
              l.created_at, l.updated_at,
              p.name AS pipeline, s.name AS stage, u.name AS assigned_name
       FROM leads l
       LEFT JOIN pipelines p ON p.id = l.pipeline_id
       LEFT JOIN pipeline_stages s ON s.id = l.stage_id
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.id=$1::uuid AND l.tenant_id=$2::uuid AND l.is_deleted=FALSE${assignedFilter}`,
      params
    );
    const lead = r.rows[0];
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

    const tags = await query(
      `SELECT t.id, t.name, t.color FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id=$1`,
      [id]
    ).catch(() => ({ rows: [] as any[] }));

    // Full timeline incl. call activities (to match the CRM). For type='call' the
    // `detail` holds the call_log id — exposed as call_id so the app can attach the
    // recording player and never render the raw UUID.
    const activities = await query(
      `SELECT a.type, a.title, a.detail, a.created_at, u.name AS by_name,
              CASE WHEN a.type='call' THEN a.detail ELSE NULL END AS call_id
       FROM lead_activities a LEFT JOIN users u ON u.id = a.created_by
       WHERE a.lead_id=$1 ORDER BY a.created_at DESC LIMIT 80`,
      [id]
    ).catch(() => ({ rows: [] as any[] }));

    const calls = await query(
      `SELECT id, direction, outcome, duration_seconds, started_at,
              (recording_path IS NOT NULL OR recording_url IS NOT NULL) AS has_recording
       FROM call_logs WHERE lead_id=$1 AND tenant_id=$2::uuid ORDER BY started_at DESC LIMIT 50`,
      [id, tenantId]
    ).catch(() => ({ rows: [] as any[] }));

    // Can the current user reassign this lead? (owner/super_admin or leads:assign)
    let canAssign = role === 'super_admin';
    if (!canAssign) {
      const isOwner = (await query('SELECT is_owner FROM users WHERE id=$1', [userId])).rows[0]?.is_owner === true;
      canAssign = isOwner || await hasPermission(userId, 'leads:assign', tenantId);
    }

    res.json({ lead, tags: tags.rows, activities: activities.rows, calls: calls.rows, canAssign });
  } catch (err: any) {
    console.error('[mobile/leads/details]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/mobile/leads/:id/followup — schedule a follow-up. Body: { dueAt, title?, note? }
router.post('/leads/:id/followup', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const id = req.params.id;
  const dueAt = req.body?.dueAt;
  const title = cleanText(req.body?.title ?? 'Follow-up') || 'Follow-up';
  const note = cleanText(req.body?.note ?? '') || null;
  if (!dueAt) { res.status(400).json({ error: 'dueAt required' }); return; }
  try {
    const owns = await query('SELECT assigned_to FROM leads WHERE id=$1::uuid AND tenant_id=$2::uuid AND is_deleted=FALSE', [id, tenantId]);
    if (!owns.rows[0]) { res.status(404).json({ error: 'Lead not found' }); return; }
    const assignee = owns.rows[0].assigned_to || userId;
    await query(
      `INSERT INTO lead_followups (lead_id, tenant_id, title, description, due_at, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, tenantId, title, note, dueAt, assignee, userId]
    );
    await query(
      `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
       VALUES ($1,$2,'followup','Follow-up scheduled from mobile dialer',$3)`,
      [id, tenantId, userId]
    ).catch(() => null);
    res.json({ created: true });
  } catch (err: any) {
    console.error('[mobile/leads/followup]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/mobile/leads/:id/tag — add a tag to the lead. Body: { tag }
router.post('/leads/:id/tag', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const id = req.params.id;
  const tag = (req.body?.tag ?? '').toString().trim();
  if (!tag) { res.status(400).json({ error: 'tag required' }); return; }
  try {
    const owns = await query('SELECT id FROM leads WHERE id=$1::uuid AND tenant_id=$2::uuid AND is_deleted=FALSE', [id, tenantId]);
    if (!owns.rows[0]) { res.status(404).json({ error: 'Lead not found' }); return; }
    let tagId: string;
    const existing = await query('SELECT id FROM tags WHERE tenant_id=$1::uuid AND LOWER(name)=LOWER($2) LIMIT 1', [tenantId, tag]);
    if (existing.rows[0]) {
      tagId = existing.rows[0].id;
    } else {
      const ins = await query('INSERT INTO tags (tenant_id, name, color) VALUES ($1::uuid,$2,$3) RETURNING id', [tenantId, tag, '#6b7280']);
      tagId = ins.rows[0].id;
    }
    await query('INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, tagId]);
    await query(
      `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
       VALUES ($1,$2,'tag','Tag added from mobile dialer',$3,$4)`,
      [id, tenantId, tag, userId]
    ).catch(() => null);
    res.json({ added: true });
  } catch (err: any) {
    console.error('[mobile/leads/tag]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/mobile/leads — create a lead from the post-call screen.
// Body: { name, phone, pipelineId, stageId, email?, notes?, source? }
router.post('/leads', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const b = req.body || {};
  const name = cleanText(b.name ?? '');
  const phone = b.phone ? normalizePhone(b.phone.toString()) : '';
  const pipelineId = b.pipelineId || b.pipeline_id || null;
  const stageId = b.stageId || b.stage_id || null;
  const email = (b.email ?? '').toString().trim() || null;
  const notes = cleanText(b.notes ?? '') || null;
  const source = cleanText(b.source ?? 'Mobile Dialer') || 'Mobile Dialer';

  if (!name && !phone) { res.status(400).json({ error: 'name or phone required' }); return; }

  try {
    // Duplicate phone → return the existing lead so the app can show it instead.
    if (phone) {
      const dup = await query(
        `SELECT id FROM leads WHERE tenant_id=$1::uuid AND phone=$2 AND is_deleted=FALSE LIMIT 1`,
        [tenantId, phone]
      );
      if (dup.rows[0]) { res.status(409).json({ error: 'A lead with this number already exists', leadId: dup.rows[0].id }); return; }
    }

    // Auto-assign to creator if they can't view all leads (so it stays in their list).
    let assignee: string | null = null;
    let viewAll = role === 'super_admin';
    if (!viewAll) {
      const isOwner = (await query('SELECT is_owner FROM users WHERE id=$1', [userId])).rows[0]?.is_owner === true;
      if (isOwner) viewAll = true;
      else if (await hasPermission(userId, 'leads:only_assigned', tenantId)) viewAll = false;
      else viewAll = await hasPermission(userId, 'leads:view_all', tenantId);
    }
    if (!viewAll) assignee = userId!;

    const ins = await query(
      `INSERT INTO leads (tenant_id, name, email, phone, source, pipeline_id, stage_id, assigned_to, notes)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tenantId, name || phone, email, phone || null, source, pipelineId, stageId, assignee, notes]
    );
    const lead = ins.rows[0];

    await query(
      `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
       VALUES ($1,$2,'created','Lead created from mobile dialer',$3)`,
      [lead.id, tenantId, userId]
    ).catch(() => null);
    if (notes) {
      await query(
        `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
         VALUES ($1,$2,'note','Note',$3,$4)`,
        [lead.id, tenantId, notes, userId]
      ).catch(() => null);
    }

    const withName = await query(
      `SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id=l.assigned_to WHERE l.id=$1`,
      [lead.id]
    );
    const emitLead = withName.rows[0] ?? lead;
    emitToTenant(tenantId!, 'lead:created', emitLead);
    res.status(201).json({ created: true, lead: emitLead });

    setImmediate(() => {
      incrementUsage(tenantId!, 'leads').catch(() => null);
      triggerWorkflows('lead_created', lead, tenantId!, userId).catch(() => null);
    });
  } catch (err: any) {
    console.error('[mobile/leads/create]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/mobile/leads/:id/update — from the post-call screen for an EXISTING lead:
// optionally move stage/pipeline and/or add a note. Body: { stageId?, pipelineId?, note? }
router.post('/leads/:id/update', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const id = req.params.id;
  const stageId = req.body?.stageId || req.body?.stage_id || null;
  const pipelineId = req.body?.pipelineId || req.body?.pipeline_id || null;
  const note = cleanText(req.body?.note ?? '');
  try {
    const owns = await query('SELECT id, pipeline_id FROM leads WHERE id=$1::uuid AND tenant_id=$2::uuid AND is_deleted=FALSE', [id, tenantId]);
    if (!owns.rows[0]) { res.status(404).json({ error: 'Lead not found' }); return; }

    if (stageId) {
      if (pipelineId) {
        await query('UPDATE leads SET pipeline_id=$1, stage_id=$2 WHERE id=$3::uuid AND tenant_id=$4::uuid', [pipelineId, stageId, id, tenantId]);
      } else {
        await query('UPDATE leads SET stage_id=$1 WHERE id=$2::uuid AND tenant_id=$3::uuid', [stageId, id, tenantId]);
      }
      await query(
        `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
         VALUES ($1,$2,'stage','Stage changed from mobile dialer',$3)`,
        [id, tenantId, userId]
      ).catch(() => null);
    }
    if (note) {
      await query(
        `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
         VALUES ($1,$2,'note','Note',$3,$4)`,
        [id, tenantId, note, userId]
      ).catch(() => null);
    }

    const updated = await query(
      `SELECT l.id, l.name, l.phone, l.pipeline_id, l.stage_id, p.name AS pipeline, s.name AS stage
       FROM leads l LEFT JOIN pipelines p ON p.id=l.pipeline_id LEFT JOIN pipeline_stages s ON s.id=l.stage_id
       WHERE l.id=$1`, [id]
    );
    emitToTenant(tenantId!, 'lead:updated', updated.rows[0]);
    res.json({ updated: true, lead: updated.rows[0] });

    if (stageId) setImmediate(() => triggerWorkflows('stage_changed', updated.rows[0], tenantId!, userId).catch(() => null));
  } catch (err: any) {
    console.error('[mobile/leads/update]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
