import { Response, NextFunction } from 'express';
import { query } from '../db';
import { AuthRequest } from './auth';

// ── Plan definitions ──────────────────────────────────────────────────────────

type PlanTier = 'starter' | 'growth' | 'pro' | 'enterprise';

// Numeric usage limits per plan tier
export const PLAN_LIMITS: Record<PlanTier, Record<string, number>> = {
  starter:    { leads: 500,   contacts: 500,   forms: 5,   workflows: 5   },
  growth:     { leads: 5000,  contacts: 5000,  forms: 50,  workflows: 50  },
  pro:        { leads: 10000, contacts: 10000, forms: 100, workflows: 100 },
  enterprise: { leads: 99999, contacts: 99999, forms: 999, workflows: 999 },
};

// Feature gates per plan (features NOT in the list are blocked)
const PLAN_FEATURES: Record<PlanTier, Set<string>> = {
  starter:    new Set(['leads', 'contacts', 'forms', 'calendar', 'basic_workflows', 'staff_basic']),
  growth:     new Set(['leads', 'contacts', 'forms', 'calendar', 'basic_workflows', 'staff_basic',
                       'whatsapp', 'advanced_workflows', 'reports', 'landing_pages']),
  pro:        new Set(['leads', 'contacts', 'forms', 'calendar', 'basic_workflows', 'staff_basic',
                       'whatsapp', 'advanced_workflows', 'reports', 'landing_pages', 'api_access']),
  enterprise: new Set(['*']), // all features
};

function tierOrder(plan: string): number {
  return ['starter', 'growth', 'pro', 'enterprise'].indexOf(plan);
}

function hasFeature(plan: string, feature: string): boolean {
  const tier = (plan ?? 'starter') as PlanTier;
  const features = PLAN_FEATURES[tier] ?? PLAN_FEATURES.starter;
  return features.has('*') || features.has(feature);
}

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
