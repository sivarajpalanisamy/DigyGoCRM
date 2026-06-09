import { Response, NextFunction } from 'express';
import { query } from '../db';
import { AuthRequest } from './auth';

// ── Plan model ────────────────────────────────────────────────────────────────
// Plans are Monthly / Yearly only (billing cycle), with UNLIMITED usage and ALL features
// for every tenant. The old starter/growth/pro/enterprise tiers + per-tier caps and
// feature gates have been retired. Commercial gating is handled solely by the subscription
// payment-due block (requireTenant, UI-only). The two middlewares below are kept as
// pass-throughs so existing route wiring (checkPlan/checkUsage) keeps working untouched.

// ── Middleware: checkPlan(feature) ────────────────────────────────────────────
// Business model: Monthly/Yearly plans only — EVERY tenant gets ALL features, no tier
// locks. There is no starter/growth/pro/enterprise gating. The only commercial gate is the
// subscription payment-due block (requireTenant, UI-only) which never blocks lead capture
// or automation. So this is a pass-through and never limits any (incl. white-label) tenant.
export function checkPlan(_feature: string) {
  return (_req: AuthRequest, _res: Response, next: NextFunction): void => { next(); };
}

// ── Middleware: checkUsage(resource) ─────────────────────────────────────────
// No usage caps. Monthly/Yearly plans include UNLIMITED leads/contacts/forms/workflows/etc.
// for every tenant (incl. white-label). Lead capture must never be blocked, so this is a
// pass-through. (incrementUsage below still records counts for analytics/display only.)
export function checkUsage(_resource: string) {
  return async (_req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => { next(); };
}

// ── Helpers to increment / decrement usage counters ──────────────────────────

export async function incrementUsage(tenantId: string, resource: string): Promise<void> {
  try {
    await query(
      `INSERT INTO tenant_usage (tenant_id, ${resource}_count, updated_at)
         VALUES ($1, 1, NOW())
       ON CONFLICT (tenant_id) DO UPDATE
         SET ${resource}_count = tenant_usage.${resource}_count + 1, updated_at = NOW()`,
      [tenantId]
    );
  } catch { /* non-critical */ }
}

export async function decrementUsage(tenantId: string, resource: string): Promise<void> {
  try {
    await query(
      `UPDATE tenant_usage
         SET ${resource}_count = GREATEST(0, ${resource}_count - 1), updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId]
    );
  } catch { /* non-critical */ }
}
