import { Router, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';
import { normalizePhone } from '../utils/phone';
import { sendEmail } from '../services/email';

// Owner-side management of paired mobile devices (DigyGo Dialer app).
// Device-token endpoints the phone itself calls live in routes/mobile.ts.
const router = Router();
router.use(requireAuth);
router.use(requireTenant);

const PAIRING_TTL_MS = 15 * 60 * 1000; // pairing code valid 15 minutes

// Generate a 6-digit pairing code (cryptographically secure, zero-padded)
function generatePairingCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// POST /api/devices/pairing-code — owner generates a one-time code for a staff user.
// Returns the plaintext code ONCE; only its bcrypt hash + prefix are stored.
router.post('/pairing-code', checkPermission('devices:manage'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const { userId: targetUserId, deviceLabel } = req.body as { userId?: string; deviceLabel?: string };

  if (!targetUserId) { res.status(400).json({ error: 'userId is required' }); return; }

  try {
    // Validate the target user belongs to this tenant and is active
    const u = await query(
      `SELECT id, name FROM users WHERE id=$1::uuid AND tenant_id=$2::uuid AND is_active=TRUE LIMIT 1`,
      [targetUserId, tenantId]
    );
    if (!u.rows[0]) { res.status(404).json({ error: 'Staff user not found' }); return; }

    // One active device per staff - check if this user already has an active (non-revoked) device
    const existing = await query(
      `SELECT id, device_label FROM mobile_devices
       WHERE user_id=$1::uuid AND tenant_id=$2::uuid AND revoked=FALSE LIMIT 1`,
      [targetUserId, tenantId]
    );
    if (existing.rows[0]) {
      res.status(409).json({
        error: `${u.rows[0].name} already has an active device paired. Revoke it first to pair a new one.`,
        existingDeviceId: existing.rows[0].id,
      });
      return;
    }

    // Also invalidate any unused pairing codes for this user (only one pending code at a time)
    await query(
      `UPDATE device_pairing_codes SET used=TRUE WHERE user_id=$1::uuid AND tenant_id=$2::uuid AND used=FALSE`,
      [targetUserId, tenantId]
    );

    const code = generatePairingCode();
    const codeHash = await bcrypt.hash(code, 10);
    const codePrefix = code.substring(0, 8);
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);

    await query(
      `INSERT INTO device_pairing_codes
         (tenant_id, user_id, device_label, code_hash, code_prefix, created_by, expires_at)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7)`,
      [tenantId, targetUserId, deviceLabel ?? null, codeHash, codePrefix, userId, expiresAt]
    );

    res.json({ code, expiresAt: expiresAt.toISOString(), staffName: u.rows[0].name });
  } catch (err: any) {
    console.error('[devices/pairing-code]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/devices/staff — all active users (including owner) for the pairing dropdown
router.get('/staff', checkPermission('devices:view'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  try {
    const result = await query(
      `SELECT id, name, email, is_owner
       FROM users WHERE tenant_id=$1::uuid AND is_active=TRUE
       ORDER BY is_owner DESC NULLS LAST, name ASC`,
      [tenantId]
    );
    res.json({ staff: result.rows });
  } catch (err: any) {
    console.error('[devices/staff]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/devices — list bound devices for the tenant
router.get('/', checkPermission('devices:view'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  try {
    const result = await query(
      `SELECT d.id, d.device_label, d.platform, d.app_version, d.last_seen_at,
              d.revoked, d.created_at,
              u.id AS user_id, u.name AS user_name, u.email AS user_email
       FROM mobile_devices d
       JOIN users u ON u.id = d.user_id
       WHERE d.tenant_id = $1::uuid
       ORDER BY d.created_at DESC`,
      [tenantId]
    );
    res.json({ devices: result.rows });
  } catch (err: any) {
    console.error('[devices/list]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/devices/:id — revoke a device (instant: deviceAuth re-checks revoked each request)
router.delete('/:id', checkPermission('devices:manage'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  try {
    const result = await query(
      `UPDATE mobile_devices SET revoked = TRUE
       WHERE id = $1::uuid AND tenant_id = $2::uuid
       RETURNING id`,
      [req.params.id, tenantId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Device not found' }); return; }
    res.json({ revoked: true });
  } catch (err: any) {
    console.error('[devices/revoke]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Dialer number OTP verification (dashboard side) ────────────────────────────
const OTP_TTL_MS = 10 * 60 * 1000;

// POST /api/devices/number/request-otp — register a number + email an OTP to the user.
router.post('/number/request-otp', checkPermission('devices:manage'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const phone = normalizePhone((req.body?.phone ?? '').toString());
  const targetUserId = (req.body?.userId ?? '').toString().trim() || userId;
  if (!phone || phone.length < 8) { res.status(400).json({ error: 'Valid phone number required' }); return; }

  try {
    // Validate the target user belongs to this tenant
    const targetUser = await query(
      `SELECT id, name FROM users WHERE id=$1::uuid AND tenant_id=$2::uuid AND is_active=TRUE LIMIT 1`,
      [targetUserId, tenantId]
    );
    if (!targetUser.rows[0]) { res.status(404).json({ error: 'Staff user not found' }); return; }

    // One number per organisation: block if it's already verified under a DIFFERENT tenant.
    const claimed = await query(
      `SELECT 1 FROM dialer_number_verifications
       WHERE phone_number=$1 AND verified=TRUE AND tenant_id <> $2::uuid LIMIT 1`,
      [phone, tenantId]
    );
    if (claimed.rows[0]) {
      res.status(409).json({ code: 'number_in_use', error: 'This number is already registered with another organisation.' });
      return;
    }

    const otp = String(crypto.randomInt(100000, 1000000)); // 6 digits
    const otpHash = await bcrypt.hash(otp, 10);
    const expires = new Date(Date.now() + OTP_TTL_MS);

    await query(
      `INSERT INTO dialer_number_verifications
         (tenant_id, user_id, phone_number, otp_hash, otp_expires_at, otp_attempts, created_by)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,0,$6::uuid)
       ON CONFLICT (tenant_id, phone_number)
       DO UPDATE SET user_id=$2::uuid, otp_hash=$4, otp_expires_at=$5, otp_attempts=0, updated_at=NOW()`,
      [tenantId, targetUserId, phone, otpHash, expires, userId]
    );

    // Delivery: email the OTP to the requesting user's registered email (SMTP).
    let channel: 'email' | null = null;
    let sentTo: string | null = null;
    const u = await query(`SELECT email, name FROM users WHERE id=$1::uuid`, [userId]);
    const to = u.rows[0]?.email;
    if (to) {
      await sendEmail({
        to,
        subject: `Your DigyGo Dialer verification code: ${otp}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;text-align:center">
                 <p style="color:#5c5245;font-size:14px">Verification code for <b>${phone}</b>:</p>
                 <p style="font-size:34px;font-weight:800;letter-spacing:8px;color:#1c1410;margin:12px 0">${otp}</p>
                 <p style="color:#9c8f84;font-size:12px">Expires in 10 minutes.</p>
               </div>`,
      }).catch((e) => console.warn('[devices/number/request-otp] email send failed:', e?.message));
      channel = 'email';
      sentTo = to;
    }

    // In dev, return the OTP so it can be tested without email delivery.
    const devOtp = process.env.NODE_ENV !== 'production' ? otp : undefined;
    res.json({ sent: true, phone, channel, sentTo, devOtp });
  } catch (err: any) {
    console.error('[devices/number/request-otp]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/devices/number/verify-otp — confirm the OTP → mark the number verified.
router.post('/number/verify-otp', checkPermission('devices:manage'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const phone = normalizePhone((req.body?.phone ?? '').toString());
  const otp = (req.body?.otp ?? '').toString().trim();
  if (!phone || !otp) { res.status(400).json({ error: 'Phone and OTP required' }); return; }

  try {
    const r = await query(
      `SELECT id, otp_hash, otp_expires_at, otp_attempts FROM dialer_number_verifications
       WHERE tenant_id=$1::uuid AND phone_number=$2 LIMIT 1`,
      [tenantId, phone]
    );
    const row = r.rows[0];
    if (!row || !row.otp_hash) { res.status(404).json({ error: 'Request an OTP first' }); return; }
    if (new Date(row.otp_expires_at).getTime() < Date.now()) { res.status(400).json({ error: 'OTP expired' }); return; }
    if (row.otp_attempts >= 5) { res.status(429).json({ error: 'Too many attempts. Request a new OTP.' }); return; }

    const ok = await bcrypt.compare(otp, row.otp_hash);
    if (!ok) {
      await query(`UPDATE dialer_number_verifications SET otp_attempts=otp_attempts+1 WHERE id=$1`, [row.id]);
      res.status(401).json({ error: 'Incorrect OTP' });
      return;
    }

    // Final guard (also covers the race between two orgs verifying at once): the
    // partial unique index on verified rows will throw 23505 if another tenant
    // already claimed this number.
    const claimed = await query(
      `SELECT 1 FROM dialer_number_verifications
       WHERE phone_number=$1 AND verified=TRUE AND tenant_id <> $2::uuid LIMIT 1`,
      [phone, tenantId]
    );
    if (claimed.rows[0]) {
      res.status(409).json({ code: 'number_in_use', error: 'This number is already registered with another organisation.' });
      return;
    }

    try {
      await query(
        `UPDATE dialer_number_verifications
         SET verified=TRUE, verified_at=NOW(), otp_hash=NULL, otp_expires_at=NULL, updated_at=NOW()
         WHERE id=$1`,
        [row.id]
      );
    } catch (e: any) {
      if (e?.code === '23505') {
        res.status(409).json({ code: 'number_in_use', error: 'This number is already registered with another organisation.' });
        return;
      }
      throw e;
    }
    res.json({ verified: true, phone });
  } catch (err: any) {
    console.error('[devices/number/verify-otp]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/devices/numbers — verified/pending numbers for the tenant.
router.get('/numbers', checkPermission('devices:view'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  try {
    const r = await query(
      `SELECT v.id, v.phone_number, v.verified, v.verified_at, v.created_at,
              v.user_id, u.name AS user_name, u.email AS user_email
       FROM dialer_number_verifications v
       JOIN users u ON u.id = v.user_id
       WHERE v.tenant_id=$1::uuid
       ORDER BY v.created_at DESC`,
      [tenantId]
    );
    res.json({ numbers: r.rows });
  } catch (err: any) {
    console.error('[devices/numbers]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/devices/number/:id — remove a verified/pending number.
router.delete('/number/:id', checkPermission('devices:manage'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  try {
    const r = await query(
      `DELETE FROM dialer_number_verifications WHERE id=$1::uuid AND tenant_id=$2::uuid RETURNING id`,
      [req.params.id, tenantId]
    );
    if (!r.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ deleted: true });
  } catch (err: any) {
    console.error('[devices/number/delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
