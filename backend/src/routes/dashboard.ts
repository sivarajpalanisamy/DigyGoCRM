import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { hasPermission } from '../middleware/permissions';

const router = Router();
router.use(requireAuth);
// No requireTenant — super_admin has no tenantId but can visit /dashboard

// GET /api/dashboard/stats
// Returns permission-gated counts. Does not require staff:view or inbox:view_all
// — uses lightweight COUNT queries scoped to tenantId only.
router.get('/stats', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const isPrivileged = role === 'super_admin' || role === 'owner';

  // Super admin with no tenant context: return empty stats (they use /admin, not /dashboard)
  if (!tenantId) {
    res.json({
      stats: {},
      visible: { total_leads: false, active_staff: false, conversations: false, appointments: false },
    });
    return;
  }

  try {
    let canSeeTotalLeads:    boolean;
    let canSeeActiveStaff:   boolean;
    let canSeeConversations: boolean;
    let canSeeAppointments:  boolean;
    let onlyAssigned:        boolean;
    let inboxViewAll:        boolean;

    if (isPrivileged) {
      canSeeTotalLeads    = true;
      canSeeActiveStaff   = true;
      canSeeConversations = true;
      canSeeAppointments  = true;
      onlyAssigned        = false;
      inboxViewAll        = true;
    } else {
      [
        canSeeTotalLeads,
        canSeeActiveStaff,
        canSeeConversations,
        canSeeAppointments,
        onlyAssigned,
        inboxViewAll,
      ] = await Promise.all([
        hasPermission(userId, 'dashboard:total_leads',   tenantId),
        hasPermission(userId, 'dashboard:active_staff',  tenantId),
        hasPermission(userId, 'dashboard:conversations', tenantId),
        hasPermission(userId, 'dashboard:appointments',  tenantId),
        hasPermission(userId, 'leads:only_assigned',     tenantId),
        hasPermission(userId, 'inbox:view_all',          tenantId),
      ]);
    }

    const stats: Record<string, number> = {};
    const fetches: Promise<void>[] = [];

    if (canSeeTotalLeads) {
      fetches.push(
        (onlyAssigned
          ? query('SELECT COUNT(*)::int AS n FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE AND assigned_to=$2', [tenantId, userId])
          : query('SELECT COUNT(*)::int AS n FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE', [tenantId])
        ).then(r => { stats.total_leads = r.rows[0].n; })
      );
    }

    if (canSeeActiveStaff) {
      fetches.push(
        query(
          'SELECT COUNT(*)::int AS n FROM users WHERE tenant_id=$1 AND is_active=TRUE AND is_owner IS NOT TRUE',
          [tenantId]
        ).then(r => { stats.active_staff = r.rows[0].n; })
      );
    }

    if (canSeeConversations) {
      fetches.push(
        (inboxViewAll
          ? query('SELECT COUNT(*)::int AS n FROM conversations WHERE tenant_id=$1', [tenantId])
          : query('SELECT COUNT(*)::int AS n FROM conversations WHERE tenant_id=$1 AND assigned_to=$2', [tenantId, userId])
        ).then(r => { stats.conversations = r.rows[0].n; })
      );
    }

    if (canSeeAppointments) {
      // Appointments are scoped to tenant only — leads:only_assigned is a leads permission,
      // not a calendar permission. All staff can see the tenant's appointment count.
      fetches.push(
        query(
          'SELECT COUNT(*)::int AS n FROM calendar_events WHERE tenant_id=$1 AND is_deleted=FALSE',
          [tenantId]
        ).then(r => { stats.appointments = r.rows[0].n; })
      );
    }

    await Promise.all(fetches);

    res.json({
      stats,
      visible: {
        total_leads:   canSeeTotalLeads,
        active_staff:  canSeeActiveStaff,
        conversations: canSeeConversations,
        appointments:  canSeeAppointments,
      },
    });
  } catch (err) {
    console.error('[dashboard:stats]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/dashboard/analytics — role-based analytics for the new dashboard
router.get('/analytics', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  if (!tenantId) { res.json({}); return; }

  const isPrivileged = role === 'super_admin' || role === 'owner';
  let onlyAssigned = false;
  let isManager = false;

  let callsViewAll = false;

  if (!isPrivileged) {
    const [oa, sm, cva] = await Promise.all([
      hasPermission(userId, 'leads:only_assigned', tenantId),
      hasPermission(userId, 'staff:manage', tenantId),
      hasPermission(userId, 'calls:view_all', tenantId),
    ]);
    onlyAssigned = oa;
    isManager    = sm;
    callsViewAll = cva;
  } else {
    callsViewAll = true;
  }

  try {
    const now          = new Date();
    const thisMonth    = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth    = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Range param — affects range_leads, source_breakdown, staff leaderboard new_in_range
    const rangeParam = (req.query.range as string) || '30d';
    const fromParam  = req.query.from as string | undefined;
    const toParam    = req.query.to   as string | undefined;
    let rangeStart: Date;
    let rangeEnd: Date = new Date();
    let rangeLabel: string;

    const startOfToday     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const endOfYesterday   = new Date(startOfToday.getTime() - 1);

    switch (rangeParam) {
      case 'today':
        rangeStart = startOfToday;
        rangeEnd   = new Date();
        rangeLabel = 'Today';
        break;
      case 'yesterday':
        rangeStart = startOfYesterday;
        rangeEnd   = endOfYesterday;
        rangeLabel = 'Yesterday';
        break;
      case 'this_week': {
        const dow  = now.getDay(); // 0=Sun
        const diff = dow === 0 ? -6 : 1 - dow;
        rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
        rangeEnd   = new Date();
        rangeLabel = 'This Week';
        break;
      }
      case 'this_month':
        rangeStart = thisMonth;
        rangeEnd   = new Date();
        rangeLabel = 'This Month';
        break;
      case 'this_quarter': {
        const quarter = Math.floor(now.getMonth() / 3);
        rangeStart = new Date(now.getFullYear(), quarter * 3, 1);
        rangeEnd   = new Date();
        rangeLabel = 'This Quarter';
        break;
      }
      case '90d':
        rangeStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        rangeEnd   = new Date();
        rangeLabel = 'Last 90 Days';
        break;
      case 'all':
        rangeStart = new Date(0);
        rangeEnd   = new Date();
        rangeLabel = 'All Time';
        break;
      case 'custom':
        rangeStart = fromParam ? new Date(fromParam) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        rangeEnd   = toParam   ? new Date(toParam + 'T23:59:59') : new Date();
        rangeLabel = fromParam && toParam ? `${fromParam} to ${toParam}` : 'Custom Range';
        break;
      default:
        rangeStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        rangeEnd   = new Date();
        rangeLabel = 'Last 30 Days';
    }

    // Parameterized "only assigned" filter. userId is appended to each query's
    // param array (never interpolated) — assignedClause(baseLen) returns the
    // clause with the correct $N index, withUser(base) appends userId when needed.
    const assignedClause = (baseLen: number) =>
      onlyAssigned ? ` AND l.assigned_to = $${baseLen + 1}` : '';
    const withUser = (base: any[]) => (onlyAssigned ? [...base, userId] : base);

    const [
      totalLeads,
      leadsThisMonth,
      leadsLastMonth,
      leadsInRange,
      convertedLeads,
      staleLeads,
      overdueFollowups,
      sourceBreakdown,
      pipelineFunnel,
      staffLeaderboard,
      todayFollowups,
      leadsNotContacted,
      sourceConversionData,
      staffAccountabilityData,
      staleLeadsList,
      untouchedLeadsList,
      callsStats,
    ] = await Promise.all([
      // Total leads — all time
      query(`SELECT COUNT(*)::int AS n FROM leads l WHERE l.tenant_id=$1 AND l.is_deleted=FALSE ${assignedClause(1)}`, withUser([tenantId])),

      // Leads this calendar month
      query(`SELECT COUNT(*)::int AS n FROM leads l WHERE l.tenant_id=$1 AND l.is_deleted=FALSE AND l.created_at >= $2 ${assignedClause(2)}`, withUser([tenantId, thisMonth])),

      // Leads last calendar month
      query(`SELECT COUNT(*)::int AS n FROM leads l WHERE l.tenant_id=$1 AND l.is_deleted=FALSE AND l.created_at >= $2 AND l.created_at <= $3 ${assignedClause(3)}`, withUser([tenantId, lastMonth, lastMonthEnd])),

      // Leads in selected range
      query(`SELECT COUNT(*)::int AS n FROM leads l WHERE l.tenant_id=$1 AND l.is_deleted=FALSE AND l.created_at >= $2 AND l.created_at <= $3 ${assignedClause(3)}`, withUser([tenantId, rangeStart, rangeEnd])),

      // Converted leads (in won stage) — all time
      query(`SELECT COUNT(*)::int AS n FROM leads l JOIN pipeline_stages ps ON ps.id = l.stage_id WHERE l.tenant_id=$1 AND l.is_deleted=FALSE AND ps.is_won=TRUE ${assignedClause(1)}`, withUser([tenantId])),

      // Stale leads — no activity in 7+ days
      query(`SELECT COUNT(*)::int AS n FROM leads l WHERE l.tenant_id=$1 AND l.is_deleted=FALSE AND l.updated_at < $2 ${assignedClause(2)}`, withUser([tenantId, sevenDaysAgo])),

      // Overdue follow-ups
      query(`SELECT COUNT(*)::int AS n FROM lead_followups f JOIN leads l ON l.id = f.lead_id WHERE f.tenant_id=$1 AND f.completed=FALSE AND f.due_at < NOW() ${assignedClause(1)}`, withUser([tenantId])),

      // Source breakdown — filtered by range
      query(`SELECT l.source, COUNT(*)::int AS count FROM leads l WHERE l.tenant_id=$1 AND l.is_deleted=FALSE AND l.created_at >= $2 AND l.created_at <= $3 ${assignedClause(3)} GROUP BY l.source ORDER BY count DESC`, withUser([tenantId, rangeStart, rangeEnd])),

      // Per-pipeline funnel — each pipeline with its own stages
      query(`
        SELECT p.id AS pipeline_id, p.name AS pipeline_name,
          ps.name AS stage, ps.is_won, ps.stage_order,
          COUNT(l.id)::int AS count
        FROM pipelines p
        JOIN pipeline_stages ps ON ps.pipeline_id = p.id
        LEFT JOIN leads l ON l.stage_id = ps.id AND l.is_deleted = FALSE AND l.tenant_id = $1
        WHERE p.tenant_id = $1
        GROUP BY p.id, p.name, ps.id, ps.name, ps.is_won, ps.stage_order
        ORDER BY p.name, ps.stage_order
      `, [tenantId]),

      // Staff leaderboard — assigned_count (all time), converted (all time), new_in_range (range-filtered)
      query(`
        SELECT u.name, u.id,
          COUNT(DISTINCT l.id)::int AS assigned_count,
          COUNT(DISTINCT CASE WHEN ps.is_won = TRUE THEN l.id END)::int AS converted,
          COUNT(DISTINCT CASE WHEN l.created_at >= $2 AND l.created_at <= $3 THEN l.id END)::int AS new_in_range
        FROM users u
        LEFT JOIN leads l ON l.assigned_to = u.id AND l.is_deleted = FALSE AND l.tenant_id = $1
        LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
        WHERE u.tenant_id = $1 AND u.is_active = TRUE AND (u.is_owner IS NULL OR u.is_owner = FALSE)
        GROUP BY u.id, u.name
        ORDER BY converted DESC
      `, [tenantId, rangeStart, rangeEnd]),

      // Today's follow-ups for this user
      query(`SELECT f.id, f.title, f.description, f.due_at, l.name AS lead_name, l.id AS lead_id FROM lead_followups f JOIN leads l ON l.id = f.lead_id WHERE f.tenant_id=$1 AND f.completed=FALSE AND DATE(f.due_at) = CURRENT_DATE ${assignedClause(1)} ORDER BY f.due_at ASC LIMIT 10`, withUser([tenantId])),

      // Leads not contacted in range (no followup exists at all)
      query(`
        SELECT COUNT(*)::int AS n
        FROM leads l
        WHERE l.tenant_id = $1 AND l.is_deleted = FALSE
          AND l.created_at >= $2 AND l.created_at <= $3
          ${assignedClause(3)}
          AND NOT EXISTS (SELECT 1 FROM lead_followups f WHERE f.lead_id = l.id)
      `, withUser([tenantId, rangeStart, rangeEnd])),

      // Source with conversion rate (period-filtered)
      query(`
        SELECT COALESCE(l.source, 'Unknown') AS source,
          COUNT(*)::int AS total,
          COUNT(CASE WHEN ps.is_won = TRUE THEN 1 END)::int AS won
        FROM leads l
        LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
        WHERE l.tenant_id = $1 AND l.is_deleted = FALSE
          AND l.created_at >= $2 AND l.created_at <= $3
          ${assignedClause(3)}
        GROUP BY l.source
        ORDER BY total DESC
      `, withUser([tenantId, rangeStart, rangeEnd])),

      // Staff accountability — assigned (all time), contacted (has any followup), won
      query(`
        SELECT u.id, u.name,
          COUNT(DISTINCT l.id)::int AS assigned,
          COUNT(DISTINCT lf_c.lead_id)::int AS contacted,
          COUNT(DISTINCT CASE WHEN ps.is_won = TRUE THEN l.id END)::int AS won
        FROM users u
        LEFT JOIN leads l ON l.assigned_to = u.id AND l.is_deleted = FALSE AND l.tenant_id = $1
        LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
        LEFT JOIN (SELECT DISTINCT lead_id FROM lead_followups) lf_c ON lf_c.lead_id = l.id
        WHERE u.tenant_id = $1 AND u.is_active = TRUE AND (u.is_owner IS NULL OR u.is_owner = FALSE)
        GROUP BY u.id, u.name
        ORDER BY assigned DESC
      `, [tenantId]),

      // Stale leads list — no activity 7+ days, top 10
      query(`
        SELECT l.id, l.name, l.source,
          ps.name AS stage, u.name AS assigned_name,
          l.updated_at,
          EXTRACT(DAY FROM NOW() - l.updated_at)::int AS days_stale
        FROM leads l
        LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
        LEFT JOIN users u ON u.id = l.assigned_to
        WHERE l.tenant_id = $1 AND l.is_deleted = FALSE
          AND l.updated_at < NOW() - INTERVAL '7 days'
          ${assignedClause(1)}
        ORDER BY l.updated_at ASC
        LIMIT 10
      `, withUser([tenantId])),

      // Untouched leads — assigned but no followup, older than 24 hours
      query(`
        SELECT l.id, l.name, l.source,
          ps.name AS stage, u.name AS assigned_name,
          l.created_at,
          (EXTRACT(EPOCH FROM NOW() - l.created_at) / 3600)::int AS hours_waiting
        FROM leads l
        LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
        LEFT JOIN users u ON u.id = l.assigned_to
        WHERE l.tenant_id = $1 AND l.is_deleted = FALSE
          AND l.assigned_to IS NOT NULL
          AND l.created_at < NOW() - INTERVAL '24 hours'
          AND NOT EXISTS (SELECT 1 FROM lead_followups f WHERE f.lead_id = l.id)
          ${assignedClause(1)}
        ORDER BY l.created_at ASC
        LIMIT 10
      `, withUser([tenantId])),

      // Calls stats — total, answered, missed in range (scoped to user if not view_all)
      query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(CASE WHEN outcome='ANSWERED' THEN 1 END)::int AS answered,
          COUNT(CASE WHEN outcome='MISSED' THEN 1 END)::int AS missed
        FROM call_logs
        WHERE tenant_id=$1::uuid
          AND COALESCE(started_at, created_at) >= $2
          AND COALESCE(started_at, created_at) <= $3
          ${callsViewAll ? '' : `AND staff_user_id = $4`}
      `, callsViewAll ? [tenantId, rangeStart, rangeEnd] : [tenantId, rangeStart, rangeEnd, userId]),
    ]);

    const total     = totalLeads.rows[0].n;
    const converted = convertedLeads.rows[0].n;
    const thisM     = leadsThisMonth.rows[0].n;
    const lastM     = leadsLastMonth.rows[0].n;
    const growth    = lastM === 0 ? (thisM > 0 ? 100 : 0) : Math.round(((thisM - lastM) / lastM) * 100);

    // Per-staff conversion rate
    const leaderboardWithRate = staffLeaderboard.rows.map((s: any) => ({
      ...s,
      conversion_rate_pct: s.assigned_count === 0 ? 0 : Math.round((s.converted / s.assigned_count) * 100),
    }));

    // Best source from range-filtered breakdown (first non-null source)
    const bestSourceRow = sourceBreakdown.rows.find((s: any) => s.source) ?? null;
    const bestSource = bestSourceRow ? { source: bestSourceRow.source as string, count: bestSourceRow.count as number } : null;

    // Source conversion with % of total
    const srcGrandTotal = sourceConversionData.rows.reduce((s: number, r: any) => s + r.total, 0);
    const sourceConversion = sourceConversionData.rows.map((r: any) => ({
      source:        r.source,
      total:         r.total,
      won:           r.won,
      pct_of_total:  srcGrandTotal === 0 ? 0 : Math.round((r.total / srcGrandTotal) * 100),
      conv_pct:      r.total === 0 ? 0 : Math.round((r.won / r.total) * 100),
    }));

    // Staff accountability with percentages
    const staffAccountability = staffAccountabilityData.rows.map((s: any) => ({
      id:            s.id,
      name:          s.name,
      assigned:      s.assigned,
      contacted:     s.contacted,
      won:           s.won,
      contacted_pct: s.assigned === 0 ? 0 : Math.round((s.contacted / s.assigned) * 100),
      conv_pct:      s.assigned === 0 ? 0 : Math.round((s.won / s.assigned) * 100),
    }));

    // Build per-pipeline funnel structure
    const funnelMap: Record<string, { id: string; name: string; stages: any[] }> = {};
    for (const row of pipelineFunnel.rows) {
      if (!funnelMap[row.pipeline_id]) {
        funnelMap[row.pipeline_id] = { id: row.pipeline_id, name: row.pipeline_name, stages: [] };
      }
      funnelMap[row.pipeline_id].stages.push({ stage: row.stage, is_won: row.is_won, count: row.count });
    }
    const pipeline_funnels = Object.values(funnelMap);

    res.json({
      total_leads:       total,
      leads_this_month:  thisM,
      leads_last_month:  lastM,
      growth_pct:        growth,
      range_leads:       leadsInRange.rows[0].n,
      range:             rangeParam,
      range_label:       rangeLabel,
      converted_leads:   converted,
      conversion_rate:   total === 0 ? 0 : Math.round((converted / total) * 100),
      stale_leads:       staleLeads.rows[0].n,
      overdue_followups: overdueFollowups.rows[0].n,
      best_source:       bestSource,
      source_breakdown:  sourceBreakdown.rows,
      pipeline_funnels,
      staff_leaderboard: leaderboardWithRate,
      today_followups:      todayFollowups.rows,
      leads_not_contacted:  leadsNotContacted.rows[0].n,
      source_conversion:    sourceConversion,
      staff_accountability: staffAccountability,
      stale_leads_list:     staleLeadsList.rows,
      untouched_leads:      untouchedLeadsList.rows,
      calls_total:          callsStats.rows[0]?.total   ?? 0,
      calls_answered:       callsStats.rows[0]?.answered ?? 0,
      calls_missed:         callsStats.rows[0]?.missed   ?? 0,
      role:                 isPrivileged ? role : (isManager ? 'manager' : 'staff'),
    });
  } catch (err) {
    console.error('[dashboard:analytics]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
