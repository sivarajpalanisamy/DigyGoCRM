import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db';
import { AuthRequest } from './auth';

// ── Device-token auth (DigyGo Dialer mobile app) ───────────────────────────────
// Mirrors requireAuth but authenticates a long-lived device token instead of a JWT.
// Security model identical to refresh tokens: bcrypt hash + 16-char indexed prefix.
//
// On success sets req.user to the SAME shape as the JWT payload, so hasPermission,
// emitToTenant, triggerWorkflows and every SQL helper work unchanged — plus
// req.deviceId for ownership checks.
//
// revoked is re-checked on EVERY request (no cache) → owner "Revoke" is instant.
export async function requireDevice(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No device token provided' });
    return;
  }
  const token = header.slice(7);
  const prefix = token.substring(0, 16);

  try {
    const result = await query(
      `SELECT d.id AS device_id, d.device_token_hash, d.revoked,
              u.id AS user_id, u.tenant_id, u.role, u.is_active AS user_active,
              t.is_active AS tenant_active, t.plan AS tenant_plan
       FROM mobile_devices d
       JOIN users u   ON u.id = d.user_id
       JOIN tenants t ON t.id = d.tenant_id
       WHERE d.device_token_prefix = $1
       LIMIT 1`,
      [prefix]
    );

    const row = result.rows[0];
    if (!row) { res.status(401).json({ error: 'Invalid device token' }); return; }
    if (row.revoked)        { res.status(401).json({ error: 'Device revoked' }); return; }
    if (!row.user_active)   { res.status(401).json({ error: 'User inactive' }); return; }
    if (!row.tenant_active) { res.status(403).json({ error: 'Account suspended. Please contact support.' }); return; }

    const match = await bcrypt.compare(token, row.device_token_hash);
    if (!match) { res.status(401).json({ error: 'Invalid device token' }); return; }

    req.user = {
      userId: row.user_id,
      tenantId: row.tenant_id,
      role: row.role,
      plan: row.tenant_plan ?? 'starter',
    };
    req.deviceId = row.device_id;

    // Fire-and-forget liveness update (don't block the request on it)
    const appVersion = (req.headers['x-app-version'] as string | undefined) ?? null;
    query(
      `UPDATE mobile_devices SET last_seen_at = NOW(), app_version = COALESCE($2, app_version) WHERE id = $1`,
      [row.device_id, appVersion]
    ).catch(() => null);

    next();
  } catch (err: any) {
    console.error('[deviceAuth]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}
