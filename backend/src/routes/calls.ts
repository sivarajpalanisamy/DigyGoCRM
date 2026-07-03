import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission, hasPermission } from '../middleware/permissions';
import { RECORDINGS_DIR } from '../utils/recordingDownloader';
import { cleanText } from '../utils/sanitize';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// GET /api/calls — all calls for tenant with filters + pagination
router.get('/', checkPermission('calls:view_own'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const { direction, outcome, staff_name, date_from, date_to, source, pipeline_id, stage_id, is_unknown, page = '1', limit = '50' } = req.query as Record<string, string>;

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

  // Source filter: 'mobile' = DigyGo Dialer, 'superfone' = Superfone integration
  if (source)      { params.push(source);                   conditions.push(`cl.source=$${params.length}`); }
  if (direction)   { params.push(direction.toUpperCase());  conditions.push(`cl.direction=$${params.length}`); }
  if (outcome)     { params.push(outcome.toUpperCase());    conditions.push(`cl.outcome=$${params.length}`); }
  if (staff_name)  { params.push(`%${staff_name}%`);        conditions.push(`cl.staff_name ILIKE $${params.length}`); }
  if (date_from)   { params.push(date_from);                conditions.push(`COALESCE(cl.started_at, cl.created_at) >= $${params.length}::timestamptz`); }
  if (date_to)     { params.push(date_to);                  conditions.push(`COALESCE(cl.started_at, cl.created_at) < $${params.length}::date + INTERVAL '1 day'`); }
  if (pipeline_id) { params.push(pipeline_id);              conditions.push(`l.pipeline_id = $${params.length}::uuid`); }
  if (stage_id)    { params.push(stage_id);                 conditions.push(`l.stage_id = $${params.length}::uuid`); }
  if (is_unknown === 'true') { conditions.push(`cl.is_unknown = TRUE`); }

  // When filtering by pipeline/stage we need INNER JOIN so calls without a lead are excluded
  const leadJoin = (pipeline_id || stage_id) ? 'JOIN' : 'LEFT JOIN';

  const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
  const where  = conditions.join(' AND ');

  try {
    const [rows, countRow] = await Promise.all([
      query(
        `SELECT cl.id, cl.cdr_id, cl.direction, cl.outcome, cl.caller_phone, cl.superfone_number,
                cl.duration_seconds, cl.started_at, cl.ended_at, cl.staff_name,
                cl.recording_url, cl.recording_path, cl.recording_downloaded,
                cl.is_unknown, cl.created_at, cl.notes, cl.disposition, cl.disposition_key, cl.source,
                l.id AS lead_id, COALESCE(l.name, cl.caller_phone) AS lead_name,
                p.name AS pipeline_name, ps.name AS stage_name
         FROM call_logs cl
         ${leadJoin} leads l ON l.id = cl.lead_id
         LEFT JOIN pipelines p ON p.id = l.pipeline_id
         LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
         WHERE ${where}
         ORDER BY COALESCE(cl.started_at, cl.created_at) DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, parseInt(limit), offset],
      ),
      query(
        `SELECT COUNT(*) FROM call_logs cl
         ${leadJoin} leads l ON l.id = cl.lead_id
         WHERE ${where}`,
        params,
      ),
    ]);
    res.json({ calls: rows.rows, total: parseInt(countRow.rows[0].count) });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/calls/stats — aggregated stats for charts
router.get('/stats', checkPermission('calls:view_own'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const { direction, outcome, staff_name, date_from, date_to, source, pipeline_id, stage_id } = req.query as Record<string, string>;

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

  if (!viewAll)    { params.push(userId); conditions.push(`cl.staff_user_id=$${params.length}::uuid`); }

  if (source)      { params.push(source);                   conditions.push(`cl.source=$${params.length}`); }
  if (direction)   { params.push(direction.toUpperCase());  conditions.push(`cl.direction=$${params.length}`); }
  if (outcome)     { params.push(outcome.toUpperCase());    conditions.push(`cl.outcome=$${params.length}`); }
  if (staff_name)  { params.push(`%${staff_name}%`);        conditions.push(`cl.staff_name ILIKE $${params.length}`); }
  if (date_from)   { params.push(date_from);                conditions.push(`COALESCE(cl.started_at, cl.created_at) >= $${params.length}::timestamptz`); }
  if (date_to)     { params.push(date_to);                  conditions.push(`COALESCE(cl.started_at, cl.created_at) < $${params.length}::date + INTERVAL '1 day'`); }
  if (pipeline_id) { params.push(pipeline_id);              conditions.push(`l.pipeline_id = $${params.length}::uuid`); }
  if (stage_id)    { params.push(stage_id);                 conditions.push(`l.stage_id = $${params.length}::uuid`); }

  // When filtering by pipeline/stage, use INNER JOIN so calls without a lead are excluded
  const needsLeadJoin = !!(pipeline_id || stage_id);
  const statsLeadJoin = needsLeadJoin ? 'JOIN leads l ON l.id = cl.lead_id' : '';

  const where = conditions.join(' AND ');

  try {
    const [kpiRes, dailyRes, outcomesRes, agentsRes, dispositionsRes, pipelinesRes] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE cl.outcome='ANSWERED')::int AS answered,
                COUNT(*) FILTER (WHERE cl.outcome IN ('MISSED','NO_ANSWER'))::int AS missed,
                COALESCE(ROUND(AVG(cl.duration_seconds) FILTER (WHERE cl.duration_seconds > 0)), 0)::int AS avg_duration,
                COUNT(*) FILTER (WHERE cl.lead_id IS NULL)::int AS unknown_calls,
                COUNT(*) FILTER (WHERE cl.direction='OUTBOUND')::int AS outbound,
                COUNT(*) FILTER (WHERE cl.direction='INBOUND')::int AS inbound
         FROM call_logs cl ${statsLeadJoin} WHERE ${where}`,
        params,
      ),
      query(
        `SELECT DATE(COALESCE(cl.started_at, cl.created_at)) AS date,
                COUNT(*) FILTER (WHERE cl.direction='INBOUND')::int AS inbound,
                COUNT(*) FILTER (WHERE cl.direction='OUTBOUND')::int AS outbound
         FROM call_logs cl ${statsLeadJoin} WHERE ${where}
         GROUP BY 1 ORDER BY 1`,
        params,
      ),
      query(
        `SELECT cl.outcome, COUNT(*)::int AS count
         FROM call_logs cl ${statsLeadJoin} WHERE ${where}
         GROUP BY 1 ORDER BY 2 DESC`,
        params,
      ),
      query(
        `SELECT cl.staff_name, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE cl.outcome='ANSWERED')::int AS answered,
                COUNT(*) FILTER (WHERE cl.outcome IN ('MISSED','NO_ANSWER','REJECTED'))::int AS missed
         FROM call_logs cl ${statsLeadJoin} WHERE ${where} AND cl.staff_name IS NOT NULL
         GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        params,
      ),
      query(
        `SELECT cl.disposition_key, cl.disposition, COUNT(*)::int AS count
         FROM call_logs cl ${statsLeadJoin} WHERE ${where} AND cl.disposition_key IS NOT NULL
         GROUP BY 1, 2 ORDER BY 3 DESC`,
        params,
      ),
      query(
        `SELECT p.name AS pipeline_name, COUNT(*)::int AS count
         FROM call_logs cl
         JOIN leads l ON l.id = cl.lead_id
         JOIN pipelines p ON p.id = l.pipeline_id
         WHERE ${where} AND cl.lead_id IS NOT NULL
         GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        params,
      ),
    ]);

    res.json({
      kpi: kpiRes.rows[0],
      daily: dailyRes.rows,
      outcomes: outcomesRes.rows,
      agents: agentsRes.rows,
      dispositions: dispositionsRes.rows,
      pipelines: pipelinesRes.rows,
    });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/calls/export — Excel export
router.get('/export', checkPermission('calls:view_own'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const { direction, outcome, staff_name, date_from, date_to, source, pipeline_id, stage_id } = req.query as Record<string, string>;

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

  if (!viewAll)    { params.push(userId); conditions.push(`cl.staff_user_id=$${params.length}::uuid`); }

  if (source)      { params.push(source);                   conditions.push(`cl.source=$${params.length}`); }
  if (direction)   { params.push(direction.toUpperCase());  conditions.push(`cl.direction=$${params.length}`); }
  if (outcome)     { params.push(outcome.toUpperCase());    conditions.push(`cl.outcome=$${params.length}`); }
  if (staff_name)  { params.push(`%${staff_name}%`);        conditions.push(`cl.staff_name ILIKE $${params.length}`); }
  if (date_from)   { params.push(date_from);                conditions.push(`COALESCE(cl.started_at, cl.created_at) >= $${params.length}::timestamptz`); }
  if (date_to)     { params.push(date_to);                  conditions.push(`COALESCE(cl.started_at, cl.created_at) < $${params.length}::date + INTERVAL '1 day'`); }
  if (pipeline_id) { params.push(pipeline_id);              conditions.push(`l.pipeline_id = $${params.length}::uuid`); }
  if (stage_id)    { params.push(stage_id);                 conditions.push(`l.stage_id = $${params.length}::uuid`); }

  const leadJoin = (pipeline_id || stage_id) ? 'JOIN' : 'LEFT JOIN';

  const where = conditions.join(' AND ');
  try {
    const result = await query(
      `SELECT cl.cdr_id, cl.direction, cl.outcome, cl.caller_phone, cl.superfone_number,
              cl.duration_seconds, cl.started_at, cl.ended_at, cl.staff_name, cl.is_unknown,
              cl.disposition, cl.notes,
              COALESCE(l.name, cl.caller_phone) AS lead_name,
              p.name AS pipeline_name, ps.name AS stage_name
       FROM call_logs cl
       ${leadJoin} leads l ON l.id = cl.lead_id
       LEFT JOIN pipelines p ON p.id = l.pipeline_id
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
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
      { header: 'Disposition',   key: 'disposition',       width: 16 },
      { header: 'Note',          key: 'notes',             width: 40 },
      { header: 'Pipeline',      key: 'pipeline_name',     width: 20 },
      { header: 'Stage',         key: 'stage_name',        width: 20 },
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
router.get('/:callId/recording', checkPermission('calls:recordings'), async (req: AuthRequest, res: Response) => {
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

    // Recording URL present but not yet downloaded — proxy through our server to avoid CORS
    if (row.recording_url) {
      return proxyRecording(req, res, row.recording_url);
    }

    res.status(404).json({ error: 'Recording not available' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/calls/:callId/download — force file download
router.get('/:callId/download', checkPermission('calls:recordings'), async (req: AuthRequest, res: Response) => {
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
      res.setHeader('Content-Disposition', `attachment; filename="call-${row.cdr_id}.mp3"`);
      return proxyRecording(req, res, row.recording_url);
    }

    res.status(404).json({ error: 'Recording not available' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

function streamFile(req: AuthRequest, res: Response, filePath: string, relPath: string): void {
  const stat = fs.statSync(filePath);
  const ext = path.extname(relPath).toLowerCase();
  const contentType = ext === '.wav' ? 'audio/wav'
    : ext === '.m4a' || ext === '.aac' ? 'audio/mp4'
    : ext === '.ogg' ? 'audio/ogg'
    : 'audio/mpeg';
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

// Proxy a remote recording URL through our server to avoid CORS issues with S3/external URLs.
async function proxyRecording(_req: AuthRequest, res: Response, url: string): Promise<void> {
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) { res.status(502).json({ error: 'Recording fetch failed' }); return; }
    const ct = upstream.headers.get('content-type') || 'audio/mpeg';
    const cl = upstream.headers.get('content-length');
    res.setHeader('Content-Type', ct);
    if (cl) res.setHeader('Content-Length', cl);
    res.setHeader('Accept-Ranges', 'bytes');
    // Pipe the readable stream from fetch to the Express response
    const { Readable } = require('stream');
    const readable = Readable.fromWeb(upstream.body as any);
    readable.pipe(res);
  } catch {
    res.status(502).json({ error: 'Recording proxy failed' });
  }
}

// --- Post-Call Disposition ---

export interface DispositionDef {
  key: string;
  label: string;
  icon: string;
  color: string;
  lead_quality?: string | null;
}

const DEFAULT_DISPOSITIONS: DispositionDef[] = [
  { key: 'interested',      label: 'Interested',      icon: '👍', color: 'emerald', lead_quality: 'Hot'  },
  { key: 'callback_later',  label: 'Callback Later',  icon: '🕐', color: 'blue',    lead_quality: null   },
  { key: 'not_reachable',   label: 'Not Reachable',   icon: '📵', color: 'red',     lead_quality: null   },
  { key: 'not_interested',  label: 'Not Interested',  icon: '😕', color: 'gray',    lead_quality: 'Cold' },
  { key: 'hot_lead',        label: 'Hot Lead',         icon: '⭐', color: 'orange',  lead_quality: 'Hot'  },
  { key: 'deal_closed',     label: 'Deal Closed',     icon: '✓',  color: 'purple',  lead_quality: null   },
];

export async function getTenantDispositions(tenantId: string): Promise<DispositionDef[]> {
  const r = await query(
    `SELECT call_dispositions FROM company_settings WHERE tenant_id=$1::uuid`,
    [tenantId],
  );
  const custom = r.rows[0]?.call_dispositions;
  if (Array.isArray(custom) && custom.length > 0) return custom;
  return DEFAULT_DISPOSITIONS;
}

// GET /api/calls/dispositions - list available post-call outcomes for this tenant
router.get('/dispositions', async (req: AuthRequest, res: Response) => {
  try {
    const disps = await getTenantDispositions(req.user!.tenantId!);
    res.json(disps);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/calls/:callId/post-call - log outcome + optional follow-up after a call
router.post('/:callId/post-call', async (req: AuthRequest, res: Response) => {
  const { tenantId, userId, role } = req.user!;
  const { callId } = req.params;
  const { disposition_key, follow_up_date, follow_up_time, note } = req.body as {
    disposition_key: string;
    follow_up_date?: string;
    follow_up_time?: string;
    note?: string;
  };

  if (!disposition_key) { res.status(400).json({ error: 'disposition_key is required' }); return; }
  // XSS-harden the free-text note (consistent with the lead/contact note endpoints).
  const cleanNote = note != null ? cleanText(note) : null;

  try {
    const disps = await getTenantDispositions(tenantId!);
    const dispDef = disps.find((d) => d.key === disposition_key);
    if (!dispDef) { res.status(400).json({ error: 'Invalid disposition_key' }); return; }

    // Fetch call - verify tenant + ownership
    const isSuper = role === 'super_admin';
    let ownershipFilter = '';
    const fetchParams: any[] = [callId, tenantId];
    if (!isSuper) {
      const isOwner = (await query('SELECT is_owner FROM users WHERE id=$1', [userId])).rows[0]?.is_owner === true;
      const canViewAll = isOwner || await hasPermission(userId, 'calls:view_all', tenantId);
      if (!canViewAll) {
        fetchParams.push(userId);
        ownershipFilter = ` AND cl.staff_user_id=$${fetchParams.length}::uuid`;
      }
    }

    const callRes = await query(
      `SELECT cl.id, cl.lead_id, cl.staff_user_id, cl.staff_name, cl.caller_phone
       FROM call_logs cl
       WHERE cl.id=$1 AND cl.tenant_id=$2::uuid${ownershipFilter}`,
      fetchParams,
    );
    const call = callRes.rows[0];
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }

    // 1. Update call_logs disposition
    await query(
      `UPDATE call_logs SET disposition_key=$2, disposition=$3, notes=COALESCE($4, notes)
       WHERE id=$1`,
      [callId, disposition_key, dispDef.label, cleanNote],
    );

    // 2. Update lead quality if mapping exists and call is linked to a lead
    if (call.lead_id && dispDef.lead_quality) {
      await query(
        `UPDATE leads SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $2::jsonb, updated_at=NOW()
         WHERE id=$1::uuid AND tenant_id=$3::uuid`,
        [call.lead_id, JSON.stringify({ lead_quality: dispDef.lead_quality }), tenantId],
      );
    }

    // 3. Create follow-up if date provided
    let followUp = null;
    if (call.lead_id && follow_up_date) {
      const dueAt = follow_up_time
        ? `${follow_up_date}T${follow_up_time}:00`
        : `${follow_up_date}T09:00:00`;
      const title = `Follow up - ${dispDef.label}`;
      const fuRes = await query(
        `INSERT INTO lead_followups (lead_id, tenant_id, title, description, due_at, assigned_to, created_by)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $6::uuid) RETURNING *`,
        [call.lead_id, tenantId, title, cleanNote, dueAt, userId],
      );
      followUp = fuRes.rows[0];

      await query(
        `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
         VALUES ($1::uuid, $2::uuid, 'followup', $3, $4::uuid)`,
        [call.lead_id, tenantId, `Follow-up scheduled: ${title}`, userId],
      );
    }

    // 4. Log disposition as activity on lead timeline
    if (call.lead_id) {
      await query(
        `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
         VALUES ($1::uuid, $2::uuid, 'call_outcome', $3, $4, $5::uuid)`,
        [call.lead_id, tenantId, `Call outcome: ${dispDef.label}`, note ?? null, userId],
      );
    }

    res.json({ ok: true, disposition: dispDef.label, follow_up: followUp });
  } catch (err: any) {
    console.error('[post-call]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Unmatched Call Actions ---

// PATCH /api/calls/:callId/link — link an unmatched call to an existing lead
router.patch('/:callId/link', checkPermission('calls:view_own'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const { callId } = req.params;
  const { lead_id } = req.body as { lead_id: string };

  if (!lead_id) { res.status(400).json({ error: 'lead_id is required' }); return; }

  try {
    // Verify call exists and belongs to tenant
    const callRes = await query(
      `SELECT id, direction, outcome, duration_seconds, staff_user_id FROM call_logs
       WHERE id=$1 AND tenant_id=$2::uuid`,
      [callId, tenantId],
    );
    if (!callRes.rows[0]) { res.status(404).json({ error: 'Call not found' }); return; }
    const call = callRes.rows[0];

    // Verify lead exists and belongs to tenant
    const leadRes = await query(
      `SELECT id, name FROM leads WHERE id=$1::uuid AND tenant_id=$2::uuid AND is_deleted=FALSE`,
      [lead_id, tenantId],
    );
    if (!leadRes.rows[0]) { res.status(404).json({ error: 'Lead not found' }); return; }

    // Update call log
    await query(
      `UPDATE call_logs SET lead_id=$1::uuid, is_unknown=FALSE WHERE id=$2 AND tenant_id=$3::uuid`,
      [lead_id, callId, tenantId],
    );

    // Create lead activity
    const dir = call.direction === 'OUTBOUND' ? 'Outgoing' : 'Incoming';
    const dur = Number(call.duration_seconds ?? 0) || 0;
    const durTxt = dur > 0 ? ` (${Math.floor(dur / 60)}m ${dur % 60}s)` : '';
    await query(
      `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
       VALUES ($1::uuid,$2::uuid,'call',$3,$4,$5::uuid)`,
      [lead_id, tenantId, `${dir} call - ${call.outcome}${durTxt}`, callId, userId],
    );

    res.json({ ok: true });
  } catch (e: any) {
    console.error('[call link]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/calls/:callId/dismiss — dismiss an unmatched call (mark as not relevant)
router.patch('/:callId/dismiss', checkPermission('calls:view_own'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { callId } = req.params;

  try {
    const result = await query(
      `UPDATE call_logs SET is_unknown=FALSE, notes=COALESCE(notes, '') || CASE WHEN notes IS NULL OR notes='' THEN '[Dismissed]' ELSE ' [Dismissed]' END
       WHERE id=$1 AND tenant_id=$2::uuid AND is_unknown=TRUE RETURNING id`,
      [callId, tenantId],
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Call not found or already resolved' }); return; }
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[call dismiss]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/calls/:callId/create-lead — create a new lead from an unmatched call and link it
router.post('/:callId/create-lead', checkPermission('leads:create'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  const { callId } = req.params;
  const { name, pipeline_id, stage_id } = req.body as { name?: string; pipeline_id?: string; stage_id?: string };

  try {
    // Verify call exists and is unmatched
    const callRes = await query(
      `SELECT id, caller_phone, direction, outcome, duration_seconds, staff_user_id, source FROM call_logs
       WHERE id=$1 AND tenant_id=$2::uuid`,
      [callId, tenantId],
    );
    if (!callRes.rows[0]) { res.status(404).json({ error: 'Call not found' }); return; }
    const call = callRes.rows[0];

    // Resolve pipeline/stage — use provided or fall back to first pipeline's first stage
    let pId = pipeline_id || null;
    let sId = stage_id || null;
    if (!pId) {
      const defPipeline = await query(
        `SELECT p.id AS pipeline_id, ps.id AS stage_id
         FROM pipelines p
         LEFT JOIN pipeline_stages ps ON ps.pipeline_id = p.id
         WHERE p.tenant_id=$1::uuid
         ORDER BY p.sort_order, ps.sort_order LIMIT 1`,
        [tenantId],
      );
      if (defPipeline.rows[0]) {
        pId = defPipeline.rows[0].pipeline_id;
        sId = sId || defPipeline.rows[0].stage_id;
      }
    }

    const leadName = (name?.trim()) || call.caller_phone || 'Unknown';
    const leadSource = call.source === 'superfone' ? 'Superfone' : call.source === 'mobile' ? 'Dialer' : 'Phone Call';

    // Create the lead
    const leadRes = await query(
      `INSERT INTO leads (tenant_id, name, phone, source, pipeline_id, stage_id, assigned_to)
       VALUES ($1::uuid, $2, $3, $7, $4::uuid, $5::uuid, $6::uuid)
       RETURNING id, name`,
      [tenantId, cleanText(leadName), call.caller_phone, pId, sId, userId, leadSource],
    );
    const lead = leadRes.rows[0];

    // Link call to the new lead
    await query(
      `UPDATE call_logs SET lead_id=$1::uuid, is_unknown=FALSE WHERE id=$2 AND tenant_id=$3::uuid`,
      [lead.id, callId, tenantId],
    );

    // Also link any other unmatched calls with the same phone to this lead
    await query(
      `UPDATE call_logs SET lead_id=$1::uuid, is_unknown=FALSE
       WHERE tenant_id=$2::uuid AND lead_id IS NULL AND is_unknown=TRUE AND caller_phone=$3`,
      [lead.id, tenantId, call.caller_phone],
    );

    // Create lead activity for the call
    const dir = call.direction === 'OUTBOUND' ? 'Outgoing' : 'Incoming';
    const dur = Number(call.duration_seconds ?? 0) || 0;
    const durTxt = dur > 0 ? ` (${Math.floor(dur / 60)}m ${dur % 60}s)` : '';
    await query(
      `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
       VALUES ($1::uuid,$2::uuid,'call',$3,$4,$5::uuid)`,
      [lead.id, tenantId, `${dir} call - ${call.outcome}${durTxt}`, callId, userId],
    );

    // Create "lead created" activity
    await query(
      `INSERT INTO lead_activities (lead_id, tenant_id, type, title, created_by)
       VALUES ($1::uuid,$2::uuid,'created','Lead created from unmatched call',$3::uuid)`,
      [lead.id, tenantId, userId],
    );

    res.json({ ok: true, lead_id: lead.id, lead_name: lead.name });
  } catch (e: any) {
    console.error('[call create-lead]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
