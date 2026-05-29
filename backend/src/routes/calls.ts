import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { RECORDINGS_DIR } from '../utils/recordingDownloader';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

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
