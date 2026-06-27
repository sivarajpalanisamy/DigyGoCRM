import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db';

export interface AuthPayload {
  userId: string;
  tenantId: string | null;
  role: string;
  plan?: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
  deviceId?: string; // set by requireDevice (mobile dialer app) — used for ownership checks
}

// ── Tenant billing/active cache: avoids a DB hit on every authenticated request ──
// 30 s TTL; invalidateTenantCache() evicts immediately (e.g. on renewal → instant unblock).
export interface TenantBilling {
  active: boolean;
  status: string | null;
  expiresAt: Date | null;
  graceDays: number;
  name: string | null;
  planPrice: number | null;
  billingCycle: string | null;
  superfoneEnabled: boolean;
  ts: number;
}
const tenantBillingCache = new Map<string, TenantBilling>();
const TENANT_TTL_MS = 30_000;

export function invalidateTenantCache(tenantId: string): void {
  tenantBillingCache.delete(tenantId);
}

export async function getTenantBilling(tenantId: string): Promise<TenantBilling | null> {
  const cached = tenantBillingCache.get(tenantId);
  if (cached && Date.now() - cached.ts < TENANT_TTL_MS) return cached;
  try {
    const r = await query(
      `SELECT is_active, subscription_status, subscription_expires_at, grace_days, name, plan_price, billing_cycle, superfone_enabled
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const row = r.rows[0];
    if (!row) return null;
    const info: TenantBilling = {
      active: row.is_active === true,
      status: row.subscription_status ?? null,
      expiresAt: row.subscription_expires_at ? new Date(row.subscription_expires_at) : null,
      graceDays: Number(row.grace_days ?? 0),
      name: row.name ?? null,
      planPrice: row.plan_price != null ? Number(row.plan_price) : null,
      billingCycle: row.billing_cycle ?? null,
      superfoneEnabled: row.superfone_enabled === true,
      ts: Date.now(),
    };
    tenantBillingCache.set(tenantId, info);
    return info;
  } catch {
    return null; // fail open on DB error — don't lock everyone out on a transient issue
  }
}

// Live decision: is the tenant's subscription currently blocking UI access?
// expiresAt is stored as END-OF-DAY, so `now >= expiresAt (+grace)` = expired.
export function isSubscriptionBlocked(info: TenantBilling): boolean {
  if (info.status === 'suspended' || info.status === 'expired') return true;
  if (info.expiresAt && Date.now() >= info.expiresAt.getTime() + info.graceDays * 86_400_000) return true;
  return false;
}

// ── Superfone/Calls feature gate (per-tenant, default off; DigyGo enables) ──────
export async function isSuperfoneEnabled(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return false;
  const info = await getTenantBilling(tenantId);
  return !!info?.superfoneEnabled;
}

export async function requireSuperfone(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.user?.role === 'super_admin') { next(); return; }
  const tid = req.user?.tenantId;
  if (tid && await isSuperfoneEnabled(tid)) { next(); return; }
  res.status(403).json({ error: 'Superfone / Calls is not enabled for this account.', feature: 'superfone' });
}

// ── requireAuth ───────────────────────────────────────────────────────────────
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
    req.user = payload;

    // Tenant-scoped users: verify the tenant is still active (hard suspend → 403).
    // The SOFT subscription block lives in requireTenant so /api/auth/* (login/me)
    // stays reachable. super_admin has tenantId=null → skip.
    if (payload.tenantId) {
      getTenantBilling(payload.tenantId)
        .then((info) => {
          if (info && !info.active) {
            res.status(403).json({ error: 'Account suspended. Please contact support.' });
          } else {
            next(); // fail open if info is null (transient DB error)
          }
        })
        .catch(() => next());
      return;
    }

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── requireTenant (+ subscription gate) ────────────────────────────────────────
// Used by the 25 tenant-DATA route files. /api/auth/*, /api/public/*, /api/webhooks/*
// and the in-process workers do NOT use it — so login, lead ingestion and automation
// keep running while only the staff UI is blocked behind the Payment Due screen.
export async function requireTenant(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user?.tenantId) {
    res.status(403).json({ error: 'This endpoint requires a tenant context. Use impersonation to access tenant data.' });
    return;
  }
  const info = await getTenantBilling(req.user.tenantId);
  if (info && isSubscriptionBlocked(info)) {
    res.status(402).json({
      blocked: true,
      code: 'subscription_expired',
      status: info.status,
      business_name: info.name,
      billing_cycle: info.billingCycle,
      expires_at: info.expiresAt ? info.expiresAt.toISOString() : null,
      amount_due: info.planPrice,
      grace_days: info.graceDays,
    });
    return;
  }
  next();
}

// ── requireSuperAdmin ─────────────────────────────────────────────────────────
export function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Super admin access required' });
    return;
  }
  next();
}
