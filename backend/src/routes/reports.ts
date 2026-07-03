import { Router, Response, NextFunction } from 'express';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { hasPermission } from '../middleware/permissions';
import { serveCached } from '../lib/cache';

const router = Router();
router.use(requireAuth);

async function requireManagerOrOwner(req: AuthRequest, res: Response, next: NextFunction) {
  const { role, userId, tenantId } = req.user!;
  if (role === 'super_admin' || role === 'owner') return next();
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const isOwnerRow = (await query('SELECT is_owner FROM users WHERE id=$1', [userId])).rows[0]?.is_owner === true;
  if (isOwnerRow) return next();
  const canManage = await hasPermission(userId, 'staff:manage', tenantId);
  if (canManage) return next();
  return res.status(403).json({ error: 'Manager or owner access required' });
}

function computeRange(rangeParam: string, fromParam?: string, toParam?: string) {
  const now = new Date();
  let start: Date;
  let end: Date = new Date();

  switch (rangeParam) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'yesterday':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
      break;
    case 'this_week': {
      const dow  = now.getDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
      break;
    }
    case 'this_quarter': {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      break;
    }
    case 'this_year':
      start = new Date(now.getFullYear(), 0, 1);
      break;
    case 'all_time':
      start = new Date('2000-01-01');
      break;
    case 'custom':
      start = fromParam ? new Date(fromParam) : new Date(now.getFullYear(), now.getMonth(), 1);
      end   = toParam   ? new Date(toParam + 'T23:59:59') : new Date();
      break;
    default: // this_month
      start = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return { start, end };
}

function requireOwner(req: AuthRequest, res: Response, next: Function) {
  const role = req.user?.role;
  if (role === 'super_admin' || role === 'owner') return next();
  return res.status(403).json({ error: 'Owner access required' });
}

// ── 1. Lead Acquisition ───────────────────────────────────────────────────────
router.get('/lead-acquisition', requireOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const { range = 'this_month', from, to } = req.query as Record<string, string>;
  const { start, end } = computeRange(range, from, to);

  try {
    await serveCached(res, { tenantId, userId, name: 'lead-acquisition', ttlSec: 120, params: req.query as any }, async () => {
    const [bySource, byDay] = await Promise.all([
      query(`
        SELECT COALESCE(l.source,'Unknown') AS source,
          COUNT(*)::int AS total,
          COUNT(CASE WHEN ps.is_won THEN 1 END)::int AS won
        FROM leads l LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        WHERE l.tenant_id=$1 AND l.is_deleted=FALSE AND l.created_at>=$2 AND l.created_at<=$3
        GROUP BY l.source ORDER BY total DESC
      `, [tenantId, start, end]),
      query(`
        SELECT TO_CHAR(DATE_TRUNC('day',created_at),'DD Mon') AS day,
          DATE_TRUNC('day',created_at) AS day_ts,
          COUNT(*)::int AS count
        FROM leads
        WHERE tenant_id=$1 AND is_deleted=FALSE AND created_at>=$2 AND created_at<=$3
        GROUP BY day_ts,day ORDER BY day_ts ASC
      `, [tenantId, start, end]),
    ]);
    return { by_source: bySource.rows, by_day: byDay.rows };
    });
  } catch (err) {
    console.error('[reports:lead-acquisition]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── 2. Pipeline Health ────────────────────────────────────────────────────────
router.get('/pipeline-health', requireOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });

  try {
    const result = await query(`
      SELECT p.id AS pipeline_id, p.name AS pipeline_name,
        ps.name AS stage_name, ps.stage_order, ps.is_won,
        COUNT(l.id)::int AS lead_count,
        COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM(NOW()-l.updated_at))/86400)::numeric),0)::int AS avg_days
      FROM pipelines p
      JOIN pipeline_stages ps ON ps.pipeline_id=p.id
      LEFT JOIN leads l ON l.stage_id=ps.id AND l.is_deleted=FALSE AND l.tenant_id=$1
      WHERE p.tenant_id=$1
      GROUP BY p.id,p.name,ps.id,ps.name,ps.stage_order,ps.is_won
      ORDER BY p.name, ps.stage_order
    `, [tenantId]);

    const map: Record<string, any> = {};
    for (const r of result.rows) {
      if (!map[r.pipeline_id]) map[r.pipeline_id] = { id: r.pipeline_id, name: r.pipeline_name, stages: [] };
      map[r.pipeline_id].stages.push({
        name: r.stage_name, count: r.lead_count, avg_days: r.avg_days ?? 0, is_won: r.is_won,
      });
    }
    res.json({ pipelines: Object.values(map) });
  } catch (err) {
    console.error('[reports:pipeline-health]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── 3. Conversion Funnel ──────────────────────────────────────────────────────
router.get('/conversion-funnel', requireOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const { range = 'this_month', from, to } = req.query as Record<string, string>;
  const { start, end } = computeRange(range, from, to);

  try {
    const r = await query(`
      SELECT
        COUNT(DISTINCT l.id)::int AS total,
        COUNT(DISTINCT CASE WHEN lf.lead_id IS NOT NULL THEN l.id END)::int AS contacted,
        COUNT(DISTINCT CASE WHEN ps.is_won THEN l.id END)::int AS won
      FROM leads l
      LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
      LEFT JOIN (SELECT DISTINCT lead_id FROM lead_followups) lf ON lf.lead_id=l.id
      WHERE l.tenant_id=$1 AND l.is_deleted=FALSE AND l.created_at>=$2 AND l.created_at<=$3
    `, [tenantId, start, end]);

    const { total, contacted, won } = r.rows[0];
    const pct = (n: number) => total > 0 ? Math.round(n / total * 100) : 0;
    res.json({
      stages: [
        { name: 'New Leads', count: total,     pct: 100 },
        { name: 'Contacted', count: contacted,  pct: pct(contacted) },
        { name: 'Won',       count: won,        pct: pct(won) },
      ],
    });
  } catch (err) {
    console.error('[reports:conversion-funnel]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── 4. Source ROI ─────────────────────────────────────────────────────────────
router.get('/source-roi', requireOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const { range = 'this_month', from, to } = req.query as Record<string, string>;
  const { start, end } = computeRange(range, from, to);

  try {
    const r = await query(`
      SELECT COALESCE(l.source,'Unknown') AS source,
        COUNT(*)::int AS total,
        COUNT(DISTINCT lf.lead_id)::int AS contacted,
        COUNT(CASE WHEN ps.is_won THEN 1 END)::int AS won,
        COALESCE(ROUND(COUNT(CASE WHEN ps.is_won THEN 1 END)::decimal/NULLIF(COUNT(*),0)*100),0)::int AS conv_pct,
        COALESCE(ROUND(COUNT(DISTINCT lf.lead_id)::decimal/NULLIF(COUNT(*),0)*100),0)::int AS contact_pct
      FROM leads l
      LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
      LEFT JOIN (SELECT DISTINCT lead_id FROM lead_followups) lf ON lf.lead_id=l.id
      WHERE l.tenant_id=$1 AND l.is_deleted=FALSE AND l.created_at>=$2 AND l.created_at<=$3
      GROUP BY l.source ORDER BY total DESC
    `, [tenantId, start, end]);
    res.json({ sources: r.rows });
  } catch (err) {
    console.error('[reports:source-roi]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── 5. Revenue / Deal Value ───────────────────────────────────────────────────
router.get('/revenue', requireOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const { range = 'this_month', from, to } = req.query as Record<string, string>;
  const { start, end } = computeRange(range, from, to);

  try {
    const [summary, trend] = await Promise.all([
      query(`
        SELECT
          COUNT(CASE WHEN ps.is_won THEN 1 END)::int AS won_count,
          COALESCE(SUM(CASE WHEN ps.is_won THEN (l.custom_fields->>'lead_value')::numeric END),0) AS won_value,
          COALESCE(SUM((l.custom_fields->>'lead_value')::numeric),0) AS pipeline_value,
          COALESCE(AVG(CASE WHEN ps.is_won THEN (l.custom_fields->>'lead_value')::numeric END),0) AS avg_deal
        FROM leads l LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        WHERE l.tenant_id=$1 AND l.is_deleted=FALSE AND l.created_at>=$2 AND l.created_at<=$3
      `, [tenantId, start, end]),
      query(`
        SELECT TO_CHAR(DATE_TRUNC('month',l.created_at),'Mon YY') AS month,
          DATE_TRUNC('month',l.created_at) AS month_ts,
          COUNT(*)::int AS new_leads,
          COUNT(CASE WHEN ps.is_won THEN 1 END)::int AS won_count,
          COALESCE(SUM(CASE WHEN ps.is_won THEN (l.custom_fields->>'lead_value')::numeric END),0) AS won_value
        FROM leads l LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        WHERE l.tenant_id=$1 AND l.is_deleted=FALSE AND l.created_at >= NOW()-INTERVAL '12 months'
        GROUP BY month_ts,month ORDER BY month_ts ASC
      `, [tenantId]),
    ]);
    res.json({ summary: summary.rows[0], trend: trend.rows });
  } catch (err) {
    console.error('[reports:revenue]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── 6. Team Performance ───────────────────────────────────────────────────────
router.get('/team-performance', requireOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const { range = 'this_month', from, to } = req.query as Record<string, string>;
  const { start, end } = computeRange(range, from, to);

  try {
    const r = await query(`
      SELECT u.id, u.name,
        COUNT(DISTINCT l.id)::int AS assigned,
        COUNT(DISTINCT CASE WHEN lf_any.lead_id IS NOT NULL THEN l.id END)::int AS contacted,
        COUNT(DISTINCT CASE WHEN ps.is_won THEN l.id END)::int AS won,
        COUNT(DISTINCT f.id)::int AS followups,
        COUNT(DISTINCT n.id)::int AS notes,
        COALESCE(ROUND(COUNT(DISTINCT CASE WHEN ps.is_won THEN l.id END)::decimal/NULLIF(COUNT(DISTINCT l.id),0)*100),0)::int AS conv_pct
      FROM users u
      LEFT JOIN leads l ON l.assigned_to=u.id AND l.is_deleted=FALSE AND l.tenant_id=$1
        AND l.created_at>=$2 AND l.created_at<=$3
      LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
      LEFT JOIN (SELECT DISTINCT lead_id FROM lead_followups WHERE tenant_id=$1) lf_any ON lf_any.lead_id=l.id
      LEFT JOIN lead_followups f ON f.lead_id=l.id AND f.tenant_id=$1 AND f.created_at>=$2 AND f.created_at<=$3
      LEFT JOIN lead_notes n ON n.lead_id=l.id AND n.tenant_id=$1 AND n.created_at>=$2 AND n.created_at<=$3
      WHERE u.tenant_id=$1 AND u.is_active=TRUE AND (u.is_owner IS NULL OR u.is_owner=FALSE)
      GROUP BY u.id,u.name ORDER BY assigned DESC
    `, [tenantId, start, end]);
    res.json({ staff: r.rows });
  } catch (err) {
    console.error('[reports:team-performance]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── 7. Growth Trend (12 months, no range filter — always shows full year) ────
router.get('/growth', requireOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });

  try {
    const r = await query(`
      SELECT TO_CHAR(DATE_TRUNC('month',l.created_at),'Mon YY') AS month,
        DATE_TRUNC('month',l.created_at) AS month_ts,
        COUNT(*)::int AS new_leads,
        COUNT(CASE WHEN ps.is_won THEN 1 END)::int AS won
      FROM leads l LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
      WHERE l.tenant_id=$1 AND l.is_deleted=FALSE
        AND l.created_at >= NOW()-INTERVAL '12 months'
      GROUP BY month_ts,month ORDER BY month_ts ASC
    `, [tenantId]);
    res.json({ months: r.rows });
  } catch (err) {
    console.error('[reports:growth]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── 8. Automation Effectiveness ───────────────────────────────────────────────
router.get('/automation', requireOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const { range = 'this_month', from, to } = req.query as Record<string, string>;
  const { start, end } = computeRange(range, from, to);

  try {
    const r = await query(`
      SELECT w.id, w.name, w.trigger_key,
        COUNT(DISTINCT we.id)::int AS total,
        COUNT(DISTINCT CASE WHEN we.status='completed' THEN we.id END)::int AS completed,
        COUNT(DISTINCT CASE WHEN we.status='failed' THEN we.id END)::int AS failed,
        COUNT(DISTINCT we.lead_id)::int AS leads_enrolled
      FROM workflows w
      LEFT JOIN workflow_executions we ON we.workflow_id=w.id
        AND we.tenant_id=$1 AND we.enrolled_at>=$2 AND we.enrolled_at<=$3
      WHERE w.tenant_id=$1 AND w.status='active'
      GROUP BY w.id,w.name,w.trigger_key ORDER BY total DESC
    `, [tenantId, start, end]);
    res.json({ workflows: r.rows });
  } catch (err) {
    console.error('[reports:automation]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── 9. Pipelines list (for pipeline analytics selector) ──────────────────────
router.get('/pipelines', requireManagerOrOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  try {
    const r = await query(
      'SELECT id, name FROM pipelines WHERE tenant_id=$1 ORDER BY name ASC',
      [tenantId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[reports:pipelines]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── 10. Pipeline Analytics ────────────────────────────────────────────────────
router.get('/pipeline-analytics', requireManagerOrOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const { pipeline_id, range = 'this_month', from, to } = req.query as Record<string, string>;
  if (!pipeline_id) return res.status(400).json({ error: 'pipeline_id required' });
  const { start, end } = computeRange(range, from, to);
  const p = [tenantId, pipeline_id, start, end];

  try {
    await serveCached(res, { tenantId, userId, name: 'pipeline-analytics', ttlSec: 180, params: req.query as any }, async () => {
    const [
      kpiRes, stagesRes, sourcesRes, flowRes, winLossRes,
      qualityRes, staffRes, fuSummaryRes, overdueRes,
      staleCountRes, staleListRes, autoRes, tagsRes,
      agingRes, callsRes,
    ] = await Promise.all([

      // 1. KPI
      query(`
        SELECT
          COUNT(DISTINCT l.id)::int AS total_leads,
          COUNT(DISTINCT CASE WHEN ps.is_won THEN l.id END)::int AS won,
          COUNT(DISTINCT CASE WHEN COALESCE(ps.is_won,FALSE)=FALSE THEN l.id END)::int AS active,
          COALESCE(ROUND(COUNT(DISTINCT CASE WHEN ps.is_won THEN l.id END)::numeric
            /NULLIF(COUNT(DISTINCT l.id),0)*100),0)::int AS conv_pct,
          COALESCE(ROUND(AVG(CASE WHEN ps.is_won
            THEN EXTRACT(EPOCH FROM(l.updated_at-l.created_at))/86400 END)::numeric),0)::int AS avg_days_to_close
        FROM leads l LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        WHERE l.tenant_id=$1 AND l.pipeline_id=$2::uuid AND l.is_deleted=FALSE
          AND l.created_at>=$3 AND l.created_at<=$4
      `, p),

      // 2. Stage funnel
      query(`
        SELECT ps.name AS stage_name, ps.stage_order, ps.is_won,
          COUNT(l.id)::int AS lead_count,
          COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM(NOW()-l.updated_at))/86400)::numeric),0)::int AS avg_days
        FROM pipeline_stages ps
        LEFT JOIN leads l ON l.stage_id=ps.id AND l.is_deleted=FALSE AND l.tenant_id=$1
          AND l.created_at>=$3 AND l.created_at<=$4
        WHERE ps.pipeline_id=$2::uuid
        GROUP BY ps.id,ps.name,ps.stage_order,ps.is_won
        ORDER BY ps.stage_order ASC
      `, p),

      // 3. Source intelligence
      query(`
        SELECT COALESCE(l.source,'Unknown') AS source,
          COUNT(*)::int AS total,
          COUNT(DISTINCT lf.lead_id)::int AS contacted,
          COUNT(CASE WHEN ps.is_won THEN 1 END)::int AS won,
          COALESCE(ROUND(COUNT(CASE WHEN ps.is_won THEN 1 END)::numeric/NULLIF(COUNT(*),0)*100),0)::int AS conv_pct
        FROM leads l
        LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        LEFT JOIN (SELECT DISTINCT lead_id FROM lead_followups) lf ON lf.lead_id=l.id
        WHERE l.tenant_id=$1 AND l.pipeline_id=$2::uuid AND l.is_deleted=FALSE
          AND l.created_at>=$3 AND l.created_at<=$4
        GROUP BY l.source ORDER BY total DESC
      `, p),

      // 4. Lead flow by day
      query(`
        SELECT TO_CHAR(DATE_TRUNC('day',created_at),'DD Mon') AS day,
          DATE_TRUNC('day',created_at) AS day_ts,
          COUNT(*)::int AS count
        FROM leads
        WHERE tenant_id=$1 AND pipeline_id=$2::uuid AND is_deleted=FALSE
          AND created_at>=$3 AND created_at<=$4
        GROUP BY day_ts,day ORDER BY day_ts ASC
      `, p),

      // 5. Win/loss monthly trend
      query(`
        SELECT TO_CHAR(DATE_TRUNC('month',l.created_at),'Mon YY') AS month,
          DATE_TRUNC('month',l.created_at) AS month_ts,
          COUNT(*)::int AS new_leads,
          COUNT(CASE WHEN ps.is_won THEN 1 END)::int AS won
        FROM leads l LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        WHERE l.tenant_id=$1 AND l.pipeline_id=$2::uuid AND l.is_deleted=FALSE
          AND l.created_at>=$3 AND l.created_at<=$4
        GROUP BY month_ts,month ORDER BY month_ts ASC
      `, p),

      // 6. Lead quality (stored in custom_fields JSONB)
      query(`
        SELECT COALESCE(l.custom_fields->>'lead_quality','unknown') AS quality, COUNT(*)::int AS count
        FROM leads l
        WHERE l.tenant_id=$1 AND l.pipeline_id=$2::uuid AND l.is_deleted=FALSE
          AND l.created_at>=$3 AND l.created_at<=$4
        GROUP BY l.custom_fields->>'lead_quality' ORDER BY count DESC
      `, p),

      // 7. Staff performance (pipeline-scoped)
      query(`
        SELECT u.id, u.name,
          COUNT(DISTINCT l.id)::int AS assigned,
          COUNT(DISTINCT CASE WHEN lf_any.lead_id IS NOT NULL THEN l.id END)::int AS contacted,
          COUNT(DISTINCT CASE WHEN ps.is_won THEN l.id END)::int AS won,
          COUNT(DISTINCT f.id)::int AS followups,
          COALESCE(ROUND(COUNT(DISTINCT CASE WHEN ps.is_won THEN l.id END)::numeric
            /NULLIF(COUNT(DISTINCT l.id),0)*100),0)::int AS conv_pct,
          COALESCE(ROUND(COUNT(DISTINCT CASE WHEN lf_any.lead_id IS NOT NULL THEN l.id END)::numeric
            /NULLIF(COUNT(DISTINCT l.id),0)*100),0)::int AS contact_pct
        FROM users u
        LEFT JOIN leads l ON l.assigned_to=u.id AND l.is_deleted=FALSE AND l.tenant_id=$1
          AND l.pipeline_id=$2::uuid AND l.created_at>=$3 AND l.created_at<=$4
        LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        LEFT JOIN (SELECT DISTINCT lead_id FROM lead_followups WHERE tenant_id=$1) lf_any ON lf_any.lead_id=l.id
        LEFT JOIN lead_followups f ON f.lead_id=l.id AND f.tenant_id=$1
          AND f.created_at>=$3 AND f.created_at<=$4
        WHERE u.tenant_id=$1 AND u.is_active=TRUE AND (u.is_owner IS NULL OR u.is_owner=FALSE)
        GROUP BY u.id,u.name ORDER BY assigned DESC
      `, p),

      // 8. Follow-up summary (period-scoped)
      query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(CASE WHEN f.completed=TRUE THEN 1 END)::int AS completed,
          COUNT(CASE WHEN f.completed IS NOT TRUE THEN 1 END)::int AS pending,
          COUNT(CASE WHEN f.completed IS NOT TRUE AND f.due_at<NOW() THEN 1 END)::int AS overdue
        FROM lead_followups f
        JOIN leads l ON l.id=f.lead_id AND l.tenant_id=$1 AND l.pipeline_id=$2::uuid AND l.is_deleted=FALSE
        WHERE f.tenant_id=$1 AND f.created_at>=$3 AND f.created_at<=$4
      `, p),

      // 9. Overdue follow-ups list (not period-scoped — show all current overdue)
      query(`
        SELECT l.name AS lead_name, l.id AS lead_id,
          u.name AS staff_name, f.due_at,
          ROUND(EXTRACT(EPOCH FROM(NOW()-f.due_at))/86400)::int AS overdue_days
        FROM lead_followups f
        JOIN leads l ON l.id=f.lead_id AND l.tenant_id=$1 AND l.pipeline_id=$2::uuid AND l.is_deleted=FALSE
        LEFT JOIN users u ON u.id=f.assigned_to
        WHERE f.tenant_id=$1 AND f.completed IS NOT TRUE AND f.due_at<NOW()
        ORDER BY f.due_at ASC LIMIT 10
      `, [tenantId, pipeline_id]),

      // 10. Stale count (>7 days no update, not in won stage)
      query(`
        SELECT COUNT(*)::int AS stale_count,
          COALESCE(MAX(EXTRACT(EPOCH FROM(NOW()-l.updated_at))/86400)::numeric::int,0) AS max_days
        FROM leads l LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        WHERE l.tenant_id=$1 AND l.pipeline_id=$2::uuid AND l.is_deleted=FALSE
          AND COALESCE(ps.is_won,FALSE)=FALSE
          AND l.updated_at<NOW()-INTERVAL '7 days'
      `, [tenantId, pipeline_id]),

      // 11. Stale leads list
      query(`
        SELECT l.id, l.name, ps.name AS stage_name, u.name AS assigned_name,
          ROUND(EXTRACT(EPOCH FROM(NOW()-l.updated_at))/86400)::int AS days_stale
        FROM leads l
        LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        LEFT JOIN users u ON u.id=l.assigned_to
        WHERE l.tenant_id=$1 AND l.pipeline_id=$2::uuid AND l.is_deleted=FALSE
          AND COALESCE(ps.is_won,FALSE)=FALSE
          AND l.updated_at<NOW()-INTERVAL '7 days'
        ORDER BY l.updated_at ASC LIMIT 10
      `, [tenantId, pipeline_id]),

      // 12. Automation activity (pipeline-scoped)
      query(`
        SELECT w.id, w.name,
          COUNT(DISTINCT we.id)::int AS total,
          COUNT(DISTINCT CASE WHEN we.status='completed' THEN we.id END)::int AS completed,
          COUNT(DISTINCT CASE WHEN we.status='failed' THEN we.id END)::int AS failed,
          COUNT(DISTINCT we.lead_id)::int AS leads_enrolled
        FROM workflows w
        LEFT JOIN workflow_executions we ON we.workflow_id=w.id AND we.tenant_id=$1
          AND we.enrolled_at>=$3 AND we.enrolled_at<=$4
          AND we.lead_id IN (
            SELECT id FROM leads WHERE tenant_id=$1 AND pipeline_id=$2::uuid AND is_deleted=FALSE
          )
        WHERE w.tenant_id=$1 AND w.status='active'
        GROUP BY w.id,w.name HAVING COUNT(DISTINCT we.id)>0
        ORDER BY total DESC LIMIT 10
      `, p),

      // 13. Tag intelligence
      query(`
        SELECT t.name, t.color,
          COUNT(DISTINCT lt.lead_id)::int AS total,
          COUNT(DISTINCT CASE WHEN ps.is_won THEN lt.lead_id END)::int AS won,
          COALESCE(ROUND(COUNT(DISTINCT CASE WHEN ps.is_won THEN lt.lead_id END)::numeric
            /NULLIF(COUNT(DISTINCT lt.lead_id),0)*100),0)::int AS conv_pct
        FROM tags t
        JOIN lead_tags lt ON lt.tag_id=t.id
        JOIN leads l ON l.id=lt.lead_id AND l.tenant_id=$1 AND l.pipeline_id=$2::uuid
          AND l.is_deleted=FALSE AND l.created_at>=$3 AND l.created_at<=$4
        LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        WHERE t.tenant_id=$1
        GROUP BY t.id,t.name,t.color ORDER BY total DESC LIMIT 10
      `, p),

      // 14. Lead aging (active leads grouped by days since creation)
      query(`
        SELECT
          CASE
            WHEN EXTRACT(EPOCH FROM (NOW()-l.created_at))/86400 <= 2 THEN '0-2d'
            WHEN EXTRACT(EPOCH FROM (NOW()-l.created_at))/86400 <= 7 THEN '3-7d'
            WHEN EXTRACT(EPOCH FROM (NOW()-l.created_at))/86400 <= 14 THEN '8-14d'
            WHEN EXTRACT(EPOCH FROM (NOW()-l.created_at))/86400 <= 30 THEN '15-30d'
            ELSE '30d+'
          END AS bucket,
          COUNT(*)::int AS count
        FROM leads l
        LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        WHERE l.tenant_id=$1 AND l.pipeline_id=$2::uuid AND l.is_deleted=FALSE
          AND COALESCE(ps.is_won,FALSE)=FALSE
          AND l.created_at>=$3 AND l.created_at<=$4
        GROUP BY 1
        ORDER BY MIN(EXTRACT(EPOCH FROM (NOW()-l.created_at))/86400) ASC
      `, p),

      // 15. Call analytics (direction x outcome breakdown)
      query(`
        SELECT cl.direction, cl.outcome,
          COUNT(*)::int AS count,
          COALESCE(ROUND(AVG(cl.duration_seconds)),0)::int AS avg_duration,
          COALESCE(SUM(cl.duration_seconds),0)::int AS total_duration
        FROM call_logs cl
        JOIN leads l ON l.id=cl.lead_id AND l.tenant_id=$1 AND l.pipeline_id=$2::uuid AND l.is_deleted=FALSE
        WHERE cl.tenant_id=$1 AND cl.started_at>=$3 AND cl.started_at<=$4
        GROUP BY cl.direction,cl.outcome
      `, p),
    ]);

    return {
      kpi:       kpiRes.rows[0] ?? {},
      stages:    stagesRes.rows,
      sources:   sourcesRes.rows,
      lead_flow: flowRes.rows,
      win_loss:  winLossRes.rows,
      quality:   qualityRes.rows,
      staff:     staffRes.rows,
      followups: {
        ...fuSummaryRes.rows[0],
        overdue_list: overdueRes.rows,
      },
      stale: {
        ...staleCountRes.rows[0],
        list: staleListRes.rows,
      },
      automation: autoRes.rows,
      tags:       tagsRes.rows,
      aging:      agingRes.rows,
      calls:      callsRes.rows,
    };
    });
  } catch (err) {
    console.error('[reports:pipeline-analytics]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── 11. Staff Personal Analytics ─────────────────────────────────────────────
router.get('/staff-analytics', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const { range = 'all_time', from, to } = req.query as Record<string, string>;
  const { start, end } = computeRange(range, from, to);

  try {
    const [kpiRes, stagesRes, sourcesRes, winLossRes, overdueRes, fuSummaryRes] = await Promise.all([

      // KPI — scoped to this user's assigned leads
      query(`
        SELECT
          COUNT(DISTINCT l.id)::int AS total_leads,
          COUNT(DISTINCT CASE WHEN ps.is_won THEN l.id END)::int AS won,
          COUNT(DISTINCT CASE WHEN COALESCE(ps.is_won,FALSE)=FALSE THEN l.id END)::int AS active,
          COALESCE(ROUND(COUNT(DISTINCT CASE WHEN ps.is_won THEN l.id END)::numeric
            /NULLIF(COUNT(DISTINCT l.id),0)*100),0)::int AS conv_pct,
          COALESCE(ROUND(AVG(CASE WHEN ps.is_won
            THEN EXTRACT(EPOCH FROM(l.updated_at-l.created_at))/86400 END)::numeric),0)::int AS avg_days_to_close
        FROM leads l LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        WHERE l.tenant_id=$1 AND l.assigned_to=$2::uuid AND l.is_deleted=FALSE
          AND l.created_at>=$3 AND l.created_at<=$4
      `, [tenantId, userId, start, end]),

      // Leads per stage
      query(`
        SELECT ps.name AS stage_name, ps.stage_order, ps.is_won,
          COUNT(l.id)::int AS lead_count
        FROM pipeline_stages ps
        LEFT JOIN leads l ON l.stage_id=ps.id AND l.is_deleted=FALSE
          AND l.tenant_id=$1 AND l.assigned_to=$2::uuid
          AND l.created_at>=$3 AND l.created_at<=$4
        JOIN pipelines p ON p.id=ps.pipeline_id AND p.tenant_id=$1
        GROUP BY ps.id,ps.name,ps.stage_order,ps.is_won
        ORDER BY ps.stage_order ASC
      `, [tenantId, userId, start, end]),

      // Sources
      query(`
        SELECT COALESCE(l.source,'Unknown') AS source,
          COUNT(*)::int AS total,
          COUNT(CASE WHEN ps.is_won THEN 1 END)::int AS won,
          COALESCE(ROUND(COUNT(CASE WHEN ps.is_won THEN 1 END)::numeric/NULLIF(COUNT(*),0)*100),0)::int AS conv_pct
        FROM leads l LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        WHERE l.tenant_id=$1 AND l.assigned_to=$2::uuid AND l.is_deleted=FALSE
          AND l.created_at>=$3 AND l.created_at<=$4
        GROUP BY l.source ORDER BY total DESC
      `, [tenantId, userId, start, end]),

      // Monthly trend
      query(`
        SELECT TO_CHAR(DATE_TRUNC('month',l.created_at),'Mon YY') AS month,
          DATE_TRUNC('month',l.created_at) AS month_ts,
          COUNT(*)::int AS new_leads,
          COUNT(CASE WHEN ps.is_won THEN 1 END)::int AS won
        FROM leads l LEFT JOIN pipeline_stages ps ON ps.id=l.stage_id
        WHERE l.tenant_id=$1 AND l.assigned_to=$2::uuid AND l.is_deleted=FALSE
          AND l.created_at>=$3 AND l.created_at<=$4
        GROUP BY month_ts,month ORDER BY month_ts ASC
      `, [tenantId, userId, start, end]),

      // Overdue follow-ups for this user
      query(`
        SELECT l.name AS lead_name, f.title, f.due_at,
          ROUND(EXTRACT(EPOCH FROM(NOW()-f.due_at))/86400)::int AS overdue_days
        FROM lead_followups f
        JOIN leads l ON l.id=f.lead_id AND l.tenant_id=$1 AND l.is_deleted=FALSE
        WHERE f.tenant_id=$1 AND f.assigned_to=$2::uuid
          AND f.completed IS NOT TRUE AND f.due_at<NOW()
        ORDER BY f.due_at ASC LIMIT 8
      `, [tenantId, userId]),

      // Follow-up summary
      query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(CASE WHEN f.completed=TRUE THEN 1 END)::int AS completed,
          COUNT(CASE WHEN f.completed IS NOT TRUE THEN 1 END)::int AS pending,
          COUNT(CASE WHEN f.completed IS NOT TRUE AND f.due_at<NOW() THEN 1 END)::int AS overdue
        FROM lead_followups f
        JOIN leads l ON l.id=f.lead_id AND l.tenant_id=$1 AND l.is_deleted=FALSE
        WHERE f.tenant_id=$1 AND f.assigned_to=$2::uuid
          AND f.created_at>=$3 AND f.created_at<=$4
      `, [tenantId, userId, start, end]),
    ]);

    res.json({
      kpi:       kpiRes.rows[0] ?? {},
      stages:    stagesRes.rows,
      sources:   sourcesRes.rows,
      win_loss:  winLossRes.rows,
      overdue_list: overdueRes.rows,
      followups: fuSummaryRes.rows[0] ?? {},
    });
  } catch (err) {
    console.error('[reports:staff-analytics]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Helper: resolve date range from period / custom dates ────────────────────
function resolveDateRange(period?: string, dateFrom?: string, dateTo?: string) {
  const now = new Date();
  let start: Date;
  let end: Date = new Date();

  switch (period) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'this_week': {
      const dow = now.getDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
      break;
    }
    case 'this_quarter': {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      break;
    }
    case 'all_time':
      start = new Date('2000-01-01');
      break;
    case 'custom':
      start = dateFrom ? new Date(dateFrom) : new Date(now.getFullYear(), now.getMonth(), 1);
      end = dateTo ? new Date(dateTo + 'T23:59:59') : new Date();
      break;
    default: // this_month
      start = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return { from: start, to: end };
}

// ── Helper: build user-scoping WHERE clause for leads ────────────────────────
async function buildLeadScopeClause(
  role: string, userId: string, tenantId: string, leadAlias: string, paramIndex: number
): Promise<{ clause: string; params: any[] }> {
  if (role === 'super_admin') return { clause: '', params: [] };
  const isOwnerRow = (await query('SELECT is_owner FROM users WHERE id=$1', [userId])).rows[0]?.is_owner === true;
  if (isOwnerRow) return { clause: '', params: [] };
  const onlyAssigned = await hasPermission(userId, 'leads:only_assigned', tenantId);
  if (onlyAssigned) {
    return { clause: ` AND ${leadAlias}.assigned_to = $${paramIndex}::uuid`, params: [userId] };
  }
  const viewAll = await hasPermission(userId, 'leads:view_all', tenantId);
  if (!viewAll) {
    return { clause: ` AND ${leadAlias}.assigned_to = $${paramIndex}::uuid`, params: [userId] };
  }
  return { clause: '', params: [] };
}

// ── T1-1. Response Time Analytics ────────────────────────────────────────────
router.get('/response-time', requireManagerOrOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const { period = 'this_month', date_from, date_to, pipeline_id } = req.query as Record<string, string>;
  const { from, to } = resolveDateRange(period, date_from, date_to);

  try {
    const scope = await buildLeadScopeClause(role, userId, tenantId, 'l', 5);
    const pipelineClause = pipeline_id ? ` AND l.pipeline_id = $${4 + scope.params.length + 1}::uuid` : '';
    const baseParams = [tenantId, from, to];
    const extraParams = [...scope.params, ...(pipeline_id ? [pipeline_id] : [])];

    // Build a CTE for first-touch per lead so we reuse it across all three queries
    const firstTouchCTE = `
      WITH lead_first_touch AS (
        SELECT l.id AS lead_id, l.assigned_to, l.created_at AS lead_created,
          (SELECT MIN(la.created_at) FROM lead_activities la
           WHERE la.lead_id = l.id AND la.tenant_id = $1::uuid
             AND la.type IN ('call','whatsapp','email','note')
          ) AS first_activity_at
        FROM leads l
        WHERE l.tenant_id = $1::uuid AND l.is_deleted = FALSE
          AND l.created_at >= $2 AND l.created_at < $3
          ${scope.clause}${pipelineClause}
      )
    `;
    const allParams = [...baseParams, ...extraParams];

    const [kpiRes, staffRes, dailyRes] = await Promise.all([
      // Overall KPI
      query(`
        ${firstTouchCTE}
        SELECT
          COUNT(*)::int AS total_leads,
          ROUND(EXTRACT(EPOCH FROM AVG(first_activity_at - lead_created)) / 60)::int AS avg_response_min,
          ROUND(EXTRACT(EPOCH FROM PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY first_activity_at - lead_created)) / 60)::int AS median_response_min,
          COUNT(*) FILTER (WHERE first_activity_at - lead_created <= INTERVAL '5 minutes')::int AS within_5min,
          COUNT(*) FILTER (WHERE first_activity_at - lead_created <= INTERVAL '30 minutes')::int AS within_30min,
          COUNT(*) FILTER (WHERE first_activity_at - lead_created <= INTERVAL '1 hour')::int AS within_1hr,
          COUNT(*) FILTER (WHERE first_activity_at IS NULL)::int AS no_response
        FROM lead_first_touch
      `, allParams),

      // Per-staff breakdown
      query(`
        ${firstTouchCTE}
        SELECT u.name AS staff_name, u.id AS staff_id,
          COUNT(lft.lead_id)::int AS total_leads,
          COUNT(*) FILTER (WHERE first_activity_at - lead_created <= INTERVAL '5 minutes')::int AS within_5min,
          COUNT(*) FILTER (WHERE first_activity_at - lead_created <= INTERVAL '30 minutes')::int AS within_30min,
          COUNT(*) FILTER (WHERE first_activity_at - lead_created <= INTERVAL '1 hour')::int AS within_1hr,
          ROUND(EXTRACT(EPOCH FROM AVG(first_activity_at - lead_created)) / 60)::int AS avg_response_min
        FROM lead_first_touch lft
        LEFT JOIN users u ON u.id = lft.assigned_to
        GROUP BY u.id, u.name
        ORDER BY avg_response_min ASC NULLS LAST
      `, allParams),

      // Daily trend
      query(`
        ${firstTouchCTE}
        SELECT DATE(lead_created) AS date,
          ROUND(EXTRACT(EPOCH FROM AVG(first_activity_at - lead_created)) / 60)::int AS avg_response_min,
          COUNT(*)::int AS total_leads
        FROM lead_first_touch
        GROUP BY DATE(lead_created)
        ORDER BY DATE(lead_created) ASC
      `, allParams),
    ]);

    res.json({
      kpi: kpiRes.rows[0] ?? {},
      staff: staffRes.rows,
      daily: dailyRes.rows,
    });
  } catch (err) {
    console.error('[reports:response-time]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── T1-2. Staff Scorecard ────────────────────────────────────────────────────
router.get('/staff-scorecard', requireManagerOrOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const { period = 'this_month', date_from, date_to } = req.query as Record<string, string>;
  const { from, to } = resolveDateRange(period, date_from, date_to);
  const p = [tenantId, from, to];

  try {
    // Run 6 simple queries in parallel, each grouped by staff (assigned_to)
    const [leadsRes, callsRes, msgsRes, fuDoneRes, fuOverdueRes, stageMovesRes, wonRes] = await Promise.all([
      // Leads assigned per staff
      query(`
        SELECT l.assigned_to AS staff_id, COUNT(*)::int AS total_leads
        FROM leads l
        WHERE l.tenant_id = $1::uuid AND l.is_deleted = FALSE
          AND l.created_at >= $2 AND l.created_at < $3
        GROUP BY l.assigned_to
      `, p),

      // Call activities per staff
      query(`
        SELECT l.assigned_to AS staff_id, COUNT(la.id)::int AS calls_made
        FROM lead_activities la
        JOIN leads l ON l.id = la.lead_id AND l.tenant_id = $1::uuid AND l.is_deleted = FALSE
        WHERE la.tenant_id = $1::uuid AND la.type = 'call'
          AND la.created_at >= $2 AND la.created_at < $3
        GROUP BY l.assigned_to
      `, p),

      // Message activities per staff
      query(`
        SELECT l.assigned_to AS staff_id, COUNT(la.id)::int AS messages_sent
        FROM lead_activities la
        JOIN leads l ON l.id = la.lead_id AND l.tenant_id = $1::uuid AND l.is_deleted = FALSE
        WHERE la.tenant_id = $1::uuid AND la.type IN ('whatsapp','email','wa_template_sent')
          AND la.created_at >= $2 AND la.created_at < $3
        GROUP BY l.assigned_to
      `, p),

      // Follow-ups completed per staff
      query(`
        SELECT f.assigned_to AS staff_id, COUNT(*)::int AS followups_completed
        FROM lead_followups f
        WHERE f.tenant_id = $1::uuid AND f.completed = TRUE
          AND f.completed_at >= $2 AND f.completed_at < $3
        GROUP BY f.assigned_to
      `, p),

      // Follow-ups overdue per staff (current, not date-scoped)
      query(`
        SELECT f.assigned_to AS staff_id, COUNT(*)::int AS followups_overdue
        FROM lead_followups f
        WHERE f.tenant_id = $1::uuid AND f.completed = FALSE AND f.due_at < NOW()
        GROUP BY f.assigned_to
      `, [tenantId]),

      // Stage moves per staff
      query(`
        SELECT l.assigned_to AS staff_id, COUNT(la.id)::int AS stages_moved
        FROM lead_activities la
        JOIN leads l ON l.id = la.lead_id AND l.tenant_id = $1::uuid AND l.is_deleted = FALSE
        WHERE la.tenant_id = $1::uuid AND la.type = 'stage_change'
          AND la.created_at >= $2 AND la.created_at < $3
        GROUP BY l.assigned_to
      `, p),

      // Won leads per staff
      query(`
        SELECT l.assigned_to AS staff_id, COUNT(*)::int AS leads_won
        FROM leads l
        JOIN pipeline_stages ps ON ps.id = l.stage_id AND ps.is_won = TRUE
        WHERE l.tenant_id = $1::uuid AND l.is_deleted = FALSE
          AND l.created_at >= $2 AND l.created_at < $3
        GROUP BY l.assigned_to
      `, p),
    ]);

    // Get staff list
    const staffRes = await query(
      `SELECT id, name FROM users WHERE tenant_id = $1::uuid AND is_active = TRUE AND (is_owner IS NULL OR is_owner = FALSE)`,
      [tenantId]
    );

    // Build lookup maps
    const toMap = (rows: any[], key: string) => {
      const m: Record<string, number> = {};
      for (const r of rows) if (r.staff_id) m[r.staff_id] = r[key];
      return m;
    };
    const leadsMap = toMap(leadsRes.rows, 'total_leads');
    const callsMap = toMap(callsRes.rows, 'calls_made');
    const msgsMap = toMap(msgsRes.rows, 'messages_sent');
    const fuDoneMap = toMap(fuDoneRes.rows, 'followups_completed');
    const fuOverdueMap = toMap(fuOverdueRes.rows, 'followups_overdue');
    const stageMap = toMap(stageMovesRes.rows, 'stages_moved');
    const wonMap = toMap(wonRes.rows, 'leads_won');

    const staff = staffRes.rows.map((s: any) => ({
      staff_id: s.id,
      staff_name: s.name,
      total_leads: leadsMap[s.id] ?? 0,
      calls_made: callsMap[s.id] ?? 0,
      messages_sent: msgsMap[s.id] ?? 0,
      followups_completed: fuDoneMap[s.id] ?? 0,
      followups_overdue: fuOverdueMap[s.id] ?? 0,
      stages_moved: stageMap[s.id] ?? 0,
      leads_won: wonMap[s.id] ?? 0,
    }));

    // Sort by total_leads descending
    staff.sort((a: any, b: any) => b.total_leads - a.total_leads);

    res.json({ staff });
  } catch (err) {
    console.error('[reports:staff-scorecard]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── T1-3. Conversion Funnel (detailed, per-pipeline) ────────────────────────
router.get('/conversion-funnel-detail', requireManagerOrOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const { pipeline_id, period = 'this_month', date_from, date_to } = req.query as Record<string, string>;
  if (!pipeline_id) return res.status(400).json({ error: 'pipeline_id required' });
  const { from, to } = resolveDateRange(period, date_from, date_to);

  try {
    const scope = await buildLeadScopeClause(role, userId, tenantId, 'l', 5);
    const allParams = [tenantId, pipeline_id, from, to, ...scope.params];

    // Stage-wise current counts + entries via lead_activities
    const [stagesRes, pipelineRes] = await Promise.all([
      query(`
        SELECT ps.id AS stage_id, ps.name AS stage_name, ps.stage_order, ps.is_won,
          COUNT(l.id)::int AS current_count,
          (
            SELECT COUNT(DISTINCT la.lead_id)::int
            FROM lead_activities la
            JOIN leads ll ON ll.id = la.lead_id AND ll.tenant_id = $1::uuid AND ll.is_deleted = FALSE
            WHERE la.tenant_id = $1::uuid AND la.type = 'stage_change'
              AND la.title ILIKE '%' || ps.name || '%'
              AND la.created_at >= $3 AND la.created_at < $4
              ${scope.clause.replace(/\bl\./g, 'll.')}
          ) AS total_entered,
          COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - l.updated_at)) / 86400))::int, 0) AS avg_days_in_stage
        FROM pipeline_stages ps
        LEFT JOIN leads l ON l.stage_id = ps.id AND l.tenant_id = $1::uuid AND l.is_deleted = FALSE
          AND l.created_at >= $3 AND l.created_at < $4
          ${scope.clause}
        WHERE ps.pipeline_id = $2::uuid
        GROUP BY ps.id, ps.name, ps.stage_order, ps.is_won
        ORDER BY ps.stage_order ASC
      `, allParams),

      query('SELECT name FROM pipelines WHERE id = $1::uuid AND tenant_id = $2::uuid', [pipeline_id, tenantId]),
    ]);

    // Calculate conversion rates: each stage's entered / first stage's entered
    const stages = stagesRes.rows;
    const firstEntered = stages.length > 0 ? (stages[0].total_entered || stages[0].current_count || 1) : 1;
    for (const s of stages) {
      const entered = s.total_entered || s.current_count || 0;
      s.conversion_pct = Math.round((entered / firstEntered) * 100);
    }

    res.json({
      pipeline_name: pipelineRes.rows[0]?.name ?? '',
      stages,
    });
  } catch (err) {
    console.error('[reports:conversion-funnel-detail]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── T1-4. Follow-up Compliance ───────────────────────────────────────────────
router.get('/followup-compliance', requireManagerOrOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const { period = 'this_month', date_from, date_to } = req.query as Record<string, string>;
  const { from, to } = resolveDateRange(period, date_from, date_to);

  try {
    const scope = await buildLeadScopeClause(role, userId, tenantId, 'l', 4);
    const baseParams = [tenantId, from, to];
    const allParams = [...baseParams, ...scope.params];
    const joinLeadScope = scope.clause ? `JOIN leads l ON l.id = f.lead_id AND l.tenant_id = $1::uuid AND l.is_deleted = FALSE${scope.clause}` : '';

    const [kpiRes, staffRes, overdueRes, dailyRes] = await Promise.all([
      // Overall KPI
      query(`
        SELECT
          COUNT(f.id)::int AS total,
          COUNT(f.id) FILTER (WHERE f.completed = TRUE)::int AS completed,
          COUNT(f.id) FILTER (WHERE f.completed = FALSE AND f.due_at < NOW())::int AS overdue,
          COUNT(f.id) FILTER (WHERE f.completed = FALSE AND f.due_at >= NOW())::int AS pending,
          COALESCE(ROUND(COUNT(f.id) FILTER (WHERE f.completed = TRUE)::numeric / NULLIF(COUNT(f.id), 0) * 100), 0)::int AS compliance_pct
        FROM lead_followups f
        ${joinLeadScope}
        WHERE f.tenant_id = $1::uuid AND f.created_at >= $2 AND f.created_at < $3
      `, allParams),

      // Per-staff breakdown
      query(`
        SELECT u.name AS staff_name, u.id AS staff_id,
          COUNT(f.id)::int AS total,
          COUNT(f.id) FILTER (WHERE f.completed = TRUE)::int AS completed,
          COUNT(f.id) FILTER (WHERE f.completed = FALSE AND f.due_at < NOW())::int AS overdue,
          COUNT(f.id) FILTER (WHERE f.completed = FALSE AND f.due_at >= NOW())::int AS pending,
          COALESCE(ROUND(COUNT(f.id) FILTER (WHERE f.completed = TRUE)::numeric / NULLIF(COUNT(f.id), 0) * 100), 0)::int AS compliance_pct
        FROM lead_followups f
        JOIN users u ON u.id = f.assigned_to
        ${joinLeadScope}
        WHERE f.tenant_id = $1::uuid AND f.created_at >= $2 AND f.created_at < $3
        GROUP BY u.id, u.name
        ORDER BY compliance_pct DESC
      `, allParams),

      // Overdue list (top 20)
      query(`
        SELECT f.id, f.title, f.due_at, l2.name AS lead_name, l2.id AS lead_id,
          u.name AS staff_name,
          EXTRACT(DAY FROM NOW() - f.due_at)::int AS overdue_days
        FROM lead_followups f
        JOIN leads l2 ON l2.id = f.lead_id AND l2.tenant_id = $1::uuid AND l2.is_deleted = FALSE
        LEFT JOIN users u ON u.id = f.assigned_to
        WHERE f.tenant_id = $1::uuid AND f.completed = FALSE AND f.due_at < NOW()
        ORDER BY f.due_at ASC LIMIT 20
      `, [tenantId]),

      // Daily trend
      query(`
        SELECT DATE(f.created_at) AS date,
          COUNT(*) FILTER (WHERE f.completed = TRUE)::int AS completed,
          COUNT(*) FILTER (WHERE f.completed = FALSE)::int AS pending
        FROM lead_followups f
        ${joinLeadScope}
        WHERE f.tenant_id = $1::uuid AND f.created_at >= $2 AND f.created_at < $3
        GROUP BY DATE(f.created_at)
        ORDER BY DATE(f.created_at) ASC
      `, allParams),
    ]);

    res.json({
      kpi: kpiRes.rows[0] ?? {},
      staff: staffRes.rows,
      overdue_list: overdueRes.rows,
      daily: dailyRes.rows,
    });
  } catch (err) {
    console.error('[reports:followup-compliance]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── T1-5. Source ROI (detailed) ──────────────────────────────────────────────
router.get('/source-roi-detail', requireManagerOrOwner, async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const { period = 'this_month', date_from, date_to } = req.query as Record<string, string>;
  const { from, to } = resolveDateRange(period, date_from, date_to);

  try {
    const scope = await buildLeadScopeClause(role, userId, tenantId, 'l', 4);
    const allParams = [tenantId, from, to, ...scope.params];

    const [sourcesRes, monthlyRes] = await Promise.all([
      // Per-source metrics
      query(`
        SELECT COALESCE(l.source, 'Unknown') AS source,
          COUNT(l.id)::int AS total_leads,
          COUNT(la_first.id)::int AS contacted,
          COUNT(l.id) FILTER (WHERE l.stage_id IN (
            SELECT id FROM pipeline_stages WHERE is_won = TRUE
          ))::int AS won,
          COALESCE(ROUND(
            COUNT(l.id) FILTER (WHERE l.stage_id IN (SELECT id FROM pipeline_stages WHERE is_won = TRUE))::numeric
            / NULLIF(COUNT(l.id), 0) * 100
          ), 0)::int AS conv_pct,
          COALESCE(ROUND(AVG(
            CASE WHEN l.stage_id IN (SELECT id FROM pipeline_stages WHERE is_won = TRUE)
              THEN EXTRACT(EPOCH FROM (l.updated_at - l.created_at)) / 86400
            END
          ))::int, 0) AS avg_days_to_convert
        FROM leads l
        LEFT JOIN LATERAL (
          SELECT la.id FROM lead_activities la
          WHERE la.lead_id = l.id AND la.tenant_id = $1::uuid
          ORDER BY la.created_at ASC LIMIT 1
        ) la_first ON TRUE
        WHERE l.tenant_id = $1::uuid AND l.is_deleted = FALSE
          AND l.created_at >= $2 AND l.created_at < $3
          ${scope.clause}
        GROUP BY COALESCE(l.source, 'Unknown')
        ORDER BY total_leads DESC
      `, allParams),

      // Monthly trend by source
      query(`
        SELECT TO_CHAR(l.created_at, 'YYYY-MM') AS month,
          COALESCE(l.source, 'Unknown') AS source,
          COUNT(l.id)::int AS count
        FROM leads l
        WHERE l.tenant_id = $1::uuid AND l.is_deleted = FALSE
          AND l.created_at >= $2 AND l.created_at < $3
          ${scope.clause}
        GROUP BY 1, 2
        ORDER BY 1 ASC
      `, allParams),
    ]);

    res.json({
      sources: sourcesRes.rows,
      monthly: monthlyRes.rows,
    });
  } catch (err) {
    console.error('[reports:source-roi-detail]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
