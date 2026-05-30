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
// Reads plan from JWT (req.user.plan) — no DB hit.
export function checkPlan(feature: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const user = req.user!;
    // super_admin has no plan restriction
    if (user.role === 'super_admin') { next(); return; }

    const plan = user.plan ?? 'starter';
    if (hasFeature(plan, feature)) {
      next();
    } else {
      res.status(402).json({
        error: `Your current plan (${plan}) does not include this feature. Please upgrade.`,
        feature,
        currentPlan: plan,
      });
    }
  };
}

// ── Middleware: checkUsage(resource) ─────────────────────────────────────────
// Checks tenant_usage against PLAN_LIMITS. Uses a DB read (fast — single PK lookup).
export function checkUsage(resource: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user!;
    if (user.role === 'super_admin' || !user.tenantId) { next(); return; }

    const plan = (user.plan ?? 'starter') as PlanTier;
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.starter;
    const limit = limits[resource];
    if (!limit) { next(); return; } // no limit defined for this resource

    try {
      // Upsert the usage row if missing (handles newly created tenants)
      await query(
        `INSERT INTO tenant_usage (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
        [user.tenantId]
      );
      const usageRes = await query(
        `SELECT ${resource}_count AS current_count FROM tenant_usage WHERE tenant_id = $1`,
        [user.tenantId]
      );
      const current = Number(usageRes.rows[0]?.current_count ?? 0);
      if (current >= limit) {
        res.status(402).json({
          error: `You have reached the ${resource} limit for your plan (${plan}: ${limit} ${resource}). Please upgrade.`,
          resource,
          currentPlan: plan,
          limit,
          current,
        });
        return;
      }
      next();
    } catch {
      next(); // fail open — don't block on usage check error
    }
  };
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
