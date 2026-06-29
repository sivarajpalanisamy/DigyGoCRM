import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission, hasPermission } from '../middleware/permissions';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// ── Shared: build user-scoping + filter conditions ──────────────────────────
async function buildConditions(
  req: AuthRequest,
  params: any[],
  conditions: string[],
) {
  const { tenantId, userId, role } = req.user!;
  const {
    status, method, date_from, date_to, pipeline_id, search,
  } = req.query as Record<string, string>;

  params.push(tenantId);
  conditions.push('pay.tenant_id=$1::uuid');

  // User scoping: only_assigned restricts to payments linked to assigned leads
  const isSuper = role === 'super_admin';
  let viewAll = true;
  if (!isSuper) {
    const isOwner = (await query('SELECT is_owner FROM users WHERE id=$1', [userId])).rows[0]?.is_owner === true;
    if (!isOwner) {
      const onlyAssigned = await hasPermission(userId, 'leads:only_assigned', tenantId);
      if (onlyAssigned) {
        viewAll = false;
      } else {
        viewAll = await hasPermission(userId, 'leads:view_all', tenantId) || true;
      }
    }
  }
  if (!viewAll) {
    params.push(userId);
    conditions.push(`(pay.lead_id IS NULL OR l.assigned_to = $${params.length}::uuid)`);
  }

  if (status)      { params.push(status);    conditions.push(`pay.status = $${params.length}`); }
  if (method)      { params.push(method);    conditions.push(`pay.method = $${params.length}`); }
  if (date_from)   { params.push(date_from); conditions.push(`pay.created_at >= $${params.length}::timestamptz`); }
  if (date_to)     { params.push(date_to);   conditions.push(`pay.created_at <= $${params.length}::timestamptz`); }
  if (pipeline_id) { params.push(pipeline_id); conditions.push(`l.pipeline_id = $${params.length}::uuid`); }
  if (search) {
    const s = `%${search}%`;
    params.push(s);
    conditions.push(`(pay.customer_name ILIKE $${params.length} OR pay.email ILIKE $${params.length} OR pay.phone ILIKE $${params.length} OR l.name ILIKE $${params.length})`);
  }

  const needsInnerJoin = !!pipeline_id || !viewAll;
  return { needsInnerJoin };
}

// GET /api/payments - list with filters + pagination
router.get('/', checkPermission('integrations:view'), async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '50' } = req.query as Record<string, string>;

  const params: any[] = [];
  const conditions: string[] = [];
  const { needsInnerJoin } = await buildConditions(req, params, conditions);

  const leadJoin = needsInnerJoin ? 'JOIN' : 'LEFT JOIN';
  const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
  const where = conditions.join(' AND ');

  try {
    const [rows, countRow] = await Promise.all([
      query(
        `SELECT pay.*,
                COALESCE(l.name, pay.customer_name, pay.email) AS lead_name,
                p.name AS pipeline_name, ps.name AS stage_name
         FROM payments pay
         ${leadJoin} leads l ON l.id = pay.lead_id
         LEFT JOIN pipelines p ON p.id = l.pipeline_id
         LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
         WHERE ${where}
         ORDER BY pay.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, parseInt(limit), offset],
      ),
      query(
        `SELECT COUNT(*) FROM payments pay
         ${leadJoin} leads l ON l.id = pay.lead_id
         WHERE ${where}`,
        params,
      ),
    ]);
    res.json({ payments: rows.rows, total: parseInt(countRow.rows[0].count) });
  } catch (e) {
    console.error('[payments list]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/payments/stats - KPI + chart data
router.get('/stats', checkPermission('integrations:view'), async (req: AuthRequest, res: Response) => {
  const params: any[] = [];
  const conditions: string[] = [];
  const { needsInnerJoin } = await buildConditions(req, params, conditions);

  const leadJoin = needsInnerJoin ? 'JOIN leads l ON l.id = pay.lead_id' : '';
  const where = conditions.join(' AND ');

  try {
    const [kpiRes, dailyRes, methodsRes] = await Promise.all([
      query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE status='captured'), 0)::bigint AS total_amount,
           COUNT(*) FILTER (WHERE status='captured')::int AS total_count,
           COALESCE(ROUND(AVG(amount) FILTER (WHERE status='captured')), 0)::int AS avg_amount,
           COALESCE(SUM(amount) FILTER (WHERE status='refunded'), 0)::bigint AS refund_amount,
           COUNT(*) FILTER (WHERE status='refunded')::int AS refund_count,
           COUNT(*) FILTER (WHERE status='failed')::int AS failed_count
         FROM payments pay ${leadJoin} WHERE ${where}`,
        params,
      ),
      query(
        `SELECT DATE(pay.created_at) AS date,
                SUM(amount)::bigint AS amount,
                COUNT(*)::int AS count
         FROM payments pay ${leadJoin}
         WHERE ${where} AND pay.status='captured'
         GROUP BY 1 ORDER BY 1`,
        params,
      ),
      query(
        `SELECT pay.method,
                COUNT(*)::int AS count,
                SUM(amount)::bigint AS amount
         FROM payments pay ${leadJoin}
         WHERE ${where} AND pay.status='captured' AND pay.method IS NOT NULL
         GROUP BY 1 ORDER BY 3 DESC`,
        params,
      ),
    ]);

    const kpi = kpiRes.rows[0];
    const totalCount = parseInt(kpi.total_count) || 0;
    const failedCount = parseInt(kpi.failed_count) || 0;
    const denominator = totalCount + failedCount;
    const successRate = denominator > 0 ? Math.round((totalCount / denominator) * 100) : 100;

    res.json({
      kpi: {
        total_amount: parseInt(kpi.total_amount) || 0,
        total_count: totalCount,
        avg_amount: parseInt(kpi.avg_amount) || 0,
        refund_amount: parseInt(kpi.refund_amount) || 0,
        refund_count: parseInt(kpi.refund_count) || 0,
        success_rate: successRate,
      },
      daily: dailyRes.rows,
      methods: methodsRes.rows,
    });
  } catch (e) {
    console.error('[payments stats]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/payments/lead/:leadId - payments for a specific lead
router.get('/lead/:leadId', async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { leadId } = req.params;
  try {
    const result = await query(
      `SELECT id, razorpay_payment_id, razorpay_order_id, amount, currency, status,
              method, email, phone, customer_name, description, notes, paid_at, created_at
       FROM payments
       WHERE tenant_id=$1::uuid AND lead_id=$2::uuid
       ORDER BY created_at DESC`,
      [tenantId, leadId],
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/payments/export - Excel export
router.get('/export', checkPermission('integrations:view'), async (req: AuthRequest, res: Response) => {
  const params: any[] = [];
  const conditions: string[] = [];
  const { needsInnerJoin } = await buildConditions(req, params, conditions);

  const leadJoin = needsInnerJoin ? 'JOIN' : 'LEFT JOIN';
  const where = conditions.join(' AND ');

  try {
    const result = await query(
      `SELECT pay.razorpay_payment_id, pay.razorpay_order_id, pay.amount, pay.currency,
              pay.status, pay.method, pay.email, pay.phone, pay.customer_name,
              pay.description, pay.paid_at, pay.created_at,
              COALESCE(l.name, pay.customer_name, pay.email) AS lead_name,
              p.name AS pipeline_name
       FROM payments pay
       ${leadJoin} leads l ON l.id = pay.lead_id
       LEFT JOIN pipelines p ON p.id = l.pipeline_id
       WHERE ${where}
       ORDER BY pay.created_at DESC
       LIMIT 5000`,
      params,
    );

    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Payments');
    ws.columns = [
      { header: 'Date',       key: 'paid_at',              width: 22 },
      { header: 'Lead Name',  key: 'lead_name',            width: 24 },
      { header: 'Amount',     key: 'amount_display',       width: 14 },
      { header: 'Status',     key: 'status',               width: 14 },
      { header: 'Method',     key: 'method',               width: 14 },
      { header: 'Payment ID', key: 'razorpay_payment_id',  width: 24 },
      { header: 'Order ID',   key: 'razorpay_order_id',    width: 24 },
      { header: 'Email',      key: 'email',                width: 24 },
      { header: 'Phone',      key: 'phone',                width: 16 },
      { header: 'Pipeline',   key: 'pipeline_name',        width: 20 },
    ];
    ws.getRow(1).font = { bold: true };
    result.rows.forEach((r) => {
      ws.addRow({ ...r, amount_display: (r.amount / 100).toFixed(2) });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="payments.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[payments export]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
