import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { hasPermission } from '../middleware/permissions';
import { serveCached } from '../lib/cache';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// GET /api/lead-generation/overview
// Returns unified form stats for both Meta and Custom forms
router.get('/overview', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;

  const isPrivileged = role === 'super_admin' || role === 'owner';
  if (!isPrivileged) {
    const [canMeta, canCustom] = await Promise.all([
      hasPermission(userId, 'meta_forms:read', tenantId),
      hasPermission(userId, 'custom_forms:read', tenantId),
    ]);
    if (!canMeta && !canCustom) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }
  }

  try {
    await serveCached(res, { tenantId: tenantId!, userId, name: 'leadgen-overview', ttlSec: 120, params: {} }, async () => {
    const [metaResult, customResult, totalRes] = await Promise.all([
      // Meta forms — join leads via meta_form_id
      query(`
        SELECT
          mf.form_id          AS id,
          mf.form_name        AS name,
          'meta'              AS channel,
          COALESCE(mf.meta_status, 'ACTIVE') AS status,
          mf.page_name,
          NULL::text          AS slug,
          COUNT(l.id) FILTER (WHERE (l.created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::int AS leads_today,
          COUNT(l.id) FILTER (WHERE l.created_at >= NOW() - INTERVAL '7 days')::int  AS leads_week,
          COUNT(l.id) FILTER (WHERE l.created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')::int AS leads_month,
          COUNT(l.id)::int    AS leads_total,
          MAX(l.created_at)   AS last_lead_at
        FROM meta_forms mf
        LEFT JOIN leads l
          ON l.meta_form_id = mf.form_id
         AND l.tenant_id    = mf.tenant_id
         AND l.is_deleted   = FALSE
        WHERE mf.tenant_id = $1 AND mf.is_active = TRUE
        GROUP BY mf.form_id, mf.form_name, mf.meta_status, mf.page_name
      `, [tenantId]),

      // Custom forms — join via custom_form_id (new leads) OR source name (pre-migration leads)
      query(`
        SELECT
          cf.id::text         AS id,
          cf.name,
          'custom'            AS channel,
          CASE WHEN cf.is_active THEN 'active' ELSE 'inactive' END AS status,
          NULL::text          AS page_name,
          cf.slug,
          COUNT(l.id) FILTER (WHERE (l.created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::int AS leads_today,
          COUNT(l.id) FILTER (WHERE l.created_at >= NOW() - INTERVAL '7 days')::int  AS leads_week,
          COUNT(l.id) FILTER (WHERE l.created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')::int AS leads_month,
          COUNT(l.id)::int    AS leads_total,
          MAX(l.created_at)   AS last_lead_at
        FROM custom_forms cf
        LEFT JOIN leads l
          ON (l.custom_form_id = cf.id OR l.source = 'form:' || cf.name)
         AND l.tenant_id   = cf.tenant_id
         AND l.is_deleted  = FALSE
        WHERE cf.tenant_id = $1 AND cf.is_active = TRUE
        GROUP BY cf.id, cf.name, cf.is_active, cf.slug
      `, [tenantId]),

      // Total leads across all sources (for KPI card)
      query(`SELECT COUNT(*)::int AS n FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE`, [tenantId]),
    ]);

    const allForms = [
      ...metaResult.rows,
      ...customResult.rows,
    ].sort((a, b) => (b.leads_month ?? 0) - (a.leads_month ?? 0));

    const leadsToday = allForms.reduce((s, f) => s + (f.leads_today ?? 0), 0);
    const bestForm   = allForms.reduce((best: any, f) =>
      (!best || (f.leads_month ?? 0) > (best.leads_month ?? 0)) ? f : best, null
    );

    // Dead: has received leads before but none in last 7 days
    const deadForms = allForms.filter(f => (f.leads_total ?? 0) > 0 && (f.leads_week ?? 0) === 0);

    return {
      summary: {
        total_leads:        totalRes.rows[0].n,
        active_forms_count: allForms.length,
        leads_today:        leadsToday,
        best_form: bestForm ? {
          name:    bestForm.name,
          channel: bestForm.channel,
          count:   bestForm.leads_month,
        } : null,
      },
      dead_forms: deadForms.map(f => ({
        id:           f.id,
        name:         f.name,
        channel:      f.channel,
        last_lead_at: f.last_lead_at,
      })),
      forms: allForms,
    };
    });
  } catch (err: any) {
    console.error('[lead-generation:overview]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/lead-generation/sparkline?channel=meta|custom&id={id}&name={name}&period=7d|month|all
// Returns chart data + last 5 leads for the form
router.get('/sparkline', async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { channel, id, name, period = '7d' } = req.query as Record<string, string>;

  // Build the WHERE clause fragment for this form
  // Custom forms: match by custom_form_id (new) OR source name (pre-migration leads)
  const formFilter = channel === 'meta'
    ? { clause: 'l.meta_form_id = $2', params: [id] }
    : { clause: "(l.custom_form_id = $2::uuid OR l.source = 'form:' || $3)", params: [id, name] };

  // Build the date filter and bucket strategy
  let dateClause: string;
  let bucketSql: string;

  if (period === 'month') {
    dateClause = `l.created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
    bucketSql  = `(l.created_at AT TIME ZONE 'Asia/Kolkata')::date`;
  } else if (period === 'all') {
    dateClause = `l.created_at >= NOW() - INTERVAL '12 months'`;
    bucketSql  = `DATE_TRUNC('month', l.created_at AT TIME ZONE 'Asia/Kolkata')`;
  } else {
    // 7d default
    dateClause = `l.created_at >= NOW() - INTERVAL '6 days'`;
    bucketSql  = `(l.created_at AT TIME ZONE 'Asia/Kolkata')::date`;
  }

  try {
    const [cr, rr] = await Promise.all([
      query(`
        SELECT ${bucketSql} AS day, COUNT(*)::int AS count
        FROM leads l
        WHERE l.tenant_id = $1 AND ${formFilter.clause} AND l.is_deleted = FALSE
          AND ${dateClause}
        GROUP BY ${bucketSql}
        ORDER BY day ASC
      `, [tenantId, ...formFilter.params]),
      query(`
        SELECT l.id, l.name, l.phone, l.email, l.created_at
        FROM leads l
        WHERE l.tenant_id = $1 AND ${formFilter.clause} AND l.is_deleted = FALSE
        ORDER BY l.created_at DESC LIMIT 5
      `, [tenantId, ...formFilter.params]),
    ]);

    const countRows = cr.rows;

    const toDateStr = (v: any): string => {
      const d = v instanceof Date ? v : new Date(v);
      return d.toISOString().split('T')[0];
    };

    let sparkline: Array<{ day: string; count: number }>;

    if (period === 'all') {
      // 12 monthly buckets
      sparkline = Array.from({ length: 12 }, (_, i) => {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - (11 - i));
        const monthStr = d.toISOString().slice(0, 7); // 'yyyy-MM'
        const found = countRows.find(r => toDateStr(r.day).slice(0, 7) === monthStr);
        return { day: d.toISOString().split('T')[0], count: found?.count ?? 0 };
      });
    } else if (period === 'month') {
      // daily for every day of current month up to today
      const now = new Date();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const today = now.getDate();
      sparkline = Array.from({ length: Math.min(daysInMonth, today) }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth(), i + 1);
        const dayStr = d.toISOString().split('T')[0];
        const found = countRows.find(r => toDateStr(r.day) === dayStr);
        return { day: dayStr, count: found?.count ?? 0 };
      });
    } else {
      // 7 daily buckets
      sparkline = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        const dayStr = d.toISOString().split('T')[0];
        const found = countRows.find(r => toDateStr(r.day) === dayStr);
        return { day: dayStr, count: found?.count ?? 0 };
      });
    }

    res.json({ sparkline, recent_leads: rr.rows });
  } catch (err: any) {
    console.error('[lead-generation:sparkline]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
