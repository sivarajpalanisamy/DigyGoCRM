import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission, hasPermission } from '../middleware/permissions';
import { RECORDINGS_DIR } from '../utils/recordingDownloader';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// GET /api/calls — all calls for tenant with filters + pagination
router.get('/', checkPermission('calls:view_own'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const { direction, outcome, staff_name, date_from, date_to, page = '1', limit = '50' } = req.query as Record<string, string>;

  // Scope: owner/super_admin and calls:view_all → see all; calls:view_own only → own calls
  const isSuper = role === 'super_admin';
  let viewAll = false;
  if (isSuper) {
    viewAll = true;
  } else {
    const isOwner = (await query('SELECT is_owner FROM users WHERE id=$1', [userId])).rows[0]?.is_owner === true;
    viewAll = isOwner || await hasPermission(userId, 'calls:view_all', tenantId);
  }

  const params: any[] = [tenantId];
  const conditions: string[] = ['cl.tenant_id=$1::uuid'];

  if (!viewAll) { params.push(userId); conditions.push(`cl.staff_user_id=$${params.length}::uuid`); }

  if (direction)  { params.push(direction.toUpperCase());  conditions.push(`cl.direction=$${params.length}`); }
  if (outcome)    { params.push(outcome.toUpperCase());    conditions.push(`cl.outcome=$${params.length}`); }
  if (staff_name) { params.push(`%${staff_name}%`);        conditions.push(`cl.staff_name ILIKE $${params.length}`); }
  if (date_from)  { params.push(date_from);                conditions.push(`COALESCE(cl.started_at, cl.created_at) >= $${params.length}::timestamptz`); }
  if (date_to)    { params.push(date_to);                  conditions.push(`COALESCE(cl.started_at, cl.created_at) <= $${params.length}::timestamptz`); }

  const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
  const where  = conditions.join(' AND ');

  try {
    const [rows, countRow] = await Promise.all([
      query(
        `SELECT cl.id, cl.cdr_id, cl.direction, cl.outcome, cl.caller_phone, cl.superfone_number,
                cl.duration_seconds, cl.started_at, cl.ended_at, cl.staff_name,
                cl.recording_url, cl.recording_path, cl.recording_downloaded,
                cl.is_unknown, cl.created_at,
                l.id AS lead_id, COALESCE(l.name, cl.caller_phone) AS lead_name
         FROM call_logs cl
         LEFT JOIN leads l ON l.id = cl.lead_id
         WHERE ${where}
         ORDER BY COALESCE(cl.started_at, cl.created_at) DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, parseInt(limit), offset],
      ),
      query(`SELECT COUNT(*) FROM call_logs cl WHERE ${where}`, params),
    ]);
    res.json({ calls: rows.rows, total: parseInt(countRow.rows[0].count) });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/calls/export — Excel export
router.get('/export', checkPermission('calls:view_own'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const { direction, outcome, staff_name, date_from, date_to } = req.query as Record<string, string>;

  const isSuper = role === 'super_admin';
  let viewAll = false;
  if (isSuper) {
    viewAll = true;
  } else {
    const isOwner = (await query('SELECT is_owner FROM users WHERE id=$1', [userId])).rows[0]?.is_owner === true;
    viewAll = isOwner || await hasPermission(userId, 'calls:view_all', tenantId);
  }

  const params: any[] = [tenantId];
  const conditions: string[] = ['cl.tenant_id=$1::uuid'];

  if (!viewAll) { params.push(userId); conditions.push(`cl.staff_user_id=$${params.length}::uuid`); }

  if (direction)  { params.push(direction.toUpperCase());  conditions.push(`cl.direction=$${params.length}`); }
  if (outcome)    { params.push(outcome.toUpperCase());    conditions.push(`cl.outcome=$${params.length}`); }
  if (staff_name) { params.push(`%${staff_name}%`);        conditions.push(`cl.staff_name ILIKE $${params.length}`); }
  if (date_from)  { params.push(date_from);                conditions.push(`COALESCE(cl.started_at, cl.created_at) >= $${params.length}::timestamptz`); }
  if (date_to)    { params.push(date_to);                  conditions.push(`COALESCE(cl.started_at, cl.created_at) <= $${params.length}::timestamptz`); }

  const where = conditions.join(' AND ');
  try {
    const result = await query(
      `SELECT cl.cdr_id, cl.direction, cl.outcome, cl.caller_phone, cl.superfone_number,
              cl.duration_seconds, cl.started_at, cl.ended_at, cl.staff_name, cl.is_unknown,
              COALESCE(l.name, cl.caller_phone) AS lead_name
       FROM call_logs cl
       LEFT JOIN leads l ON l.id = cl.lead_id
       WHERE ${where}
       ORDER BY COALESCE(cl.started_at, cl.created_at) DESC
       LIMIT 5000`,
      params,
    );

    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Call Logs');
    ws.columns = [
      { header: 'CDR ID',        key: 'cdr_id',           width: 14 },
      { header: 'Lead Name',     key: 'lead_name',         width: 22 },
      { header: 'Phone',         key: 'caller_phone',      width: 16 },
      { header: 'Direction',     key: 'direction',         width: 12 },
      { header: 'Outcome',       key: 'outcome',           width: 12 },
      { header: 'Duration (s)',  key: 'duration_seconds',  width: 14 },
      { header: 'Agent',         key: 'staff_name',        width: 20 },
      { header: 'Superfone No.', key: 'superfone_number',  width: 16 },
      { header: 'Started At',    key: 'started_at',        width: 22 },
      { header: 'Ended At',      key: 'ended_at',          width: 22 },
      { header: 'Unknown',       key: 'is_unknown',        width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    result.rows.forEach((r) => ws.addRow(r));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="call-logs.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/calls/lead/:leadId — all call logs for a lead
router.get('/lead/:leadId', async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { leadId } = req.params;
  try {
    const result = await query(
      `SELECT id, cdr_id, direction, outcome, caller_phone, superfone_number,
              duration_seconds, started_at, ended_at, staff_name,
              recording_url, recording_path, recording_downloaded, is_unknown, created_at
       FROM call_logs
       WHERE tenant_id=$1::uuid AND lead_id=$2::uuid
       ORDER BY COALESCE(started_at, created_at) DESC`,
      [tenantId, leadId],
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/calls/:callId/recording — stream audio (supports Range for seeking)
router.get('/:callId/recording', async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { callId } = req.params;

  try {
    const result = await query(
      `SELECT recording_path, cdr_id, recording_url FROM call_logs
       WHERE id=$1 AND tenant_id=$2::uuid`,
      [callId, tenantId],
    );

    const row = result.rows[0];
    if (!row) { res.status(404).json({ error: 'Call not found' }); return; }

    // Recording downloaded to disk — serve from filesystem
    if (row.recording_path) {
      const filePath = path.join(RECORDINGS_DIR, row.recording_path);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Recording file missing' }); return;
      }
      return streamFile(req, res, filePath, row.recording_path);
    }

    // Recording URL present but not yet downloaded — redirect to source URL temporarily
    if (row.recording_url) {
      res.redirect(302, row.recording_url);
      return;
    }

    res.status(404).json({ error: 'Recording not available' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/calls/:callId/download — force file download
router.get('/:callId/download', async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { callId } = req.params;

  try {
    const result = await query(
      `SELECT recording_path, cdr_id, recording_url FROM call_logs
       WHERE id=$1 AND tenant_id=$2::uuid`,
      [callId, tenantId],
    );

    const row = result.rows[0];
    if (!row) { res.status(404).json({ error: 'Call not found' }); return; }

    if (row.recording_path) {
      const filePath = path.join(RECORDINGS_DIR, row.recording_path);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Recording file missing' }); return;
      }
      const ext = path.extname(row.recording_path).toLowerCase();
      res.setHeader('Content-Disposition', `attachment; filename="call-${row.cdr_id}${ext}"`);
      return streamFile(req, res, filePath, row.recording_path);
    }

    if (row.recording_url) {
      res.redirect(302, row.recording_url);
      return;
    }

    res.status(404).json({ error: 'Recording not available' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

function streamFile(req: AuthRequest, res: Response, filePath: string, relPath: string): void {
  const stat = fs.statSync(filePath);
  const ext = path.extname(relPath).toLowerCase();
  const contentType = ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
  const range = req.headers.range;

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': chunkSize,
      'Content-Type':   contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type':   contentType,
      'Accept-Ranges':  'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

export default router;
