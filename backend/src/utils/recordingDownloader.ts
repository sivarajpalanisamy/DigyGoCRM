import fs from 'fs';
import path from 'path';
import { query } from '../db';
import { enqueue, queueActive } from '../lib/queue';

export const RECORDINGS_DIR = process.env.RECORDINGS_DIR ?? '/var/www/digygocrm/recordings';

export const RECORDING_QUEUE = 'recording-download';

interface RecordingJob { id: string; tenant_id: string; cdr_id: number; recording_url: string }

/**
 * BullMQ processor for one recording download. Registered as the
 * `recording-download` queue worker; also used as the inline fallback when Redis
 * is off. Throwing makes BullMQ retry with backoff; a clean return = done.
 */
export async function recordingDownloadProcessor(job: { data: RecordingJob }): Promise<void> {
  const { id, tenant_id, cdr_id, recording_url } = job.data;
  await downloadOne(id, tenant_id, cdr_id, recording_url);
}

/**
 * Producer — runs every 10 minutes. Finds pending recordings (self-healing: also
 * re-picks ones a previous attempt missed) and enqueues a download job for each.
 * When Redis is on, the BullMQ worker downloads them concurrently with retry;
 * when off, enqueue() runs the download inline (previous behavior). The poll
 * batch is larger now since the worker, not this loop, does the heavy lifting.
 */
export async function processRecordingDownloads(): Promise<void> {
  const limit = queueActive(RECORDING_QUEUE) ? 200 : 10; // worker can absorb more; inline stays conservative
  const pending = await query(`
    SELECT cl.id, cl.tenant_id, cl.cdr_id, cl.recording_url
    FROM call_logs cl
    JOIN tenants t ON t.id = cl.tenant_id AND t.superfone_enabled = TRUE
    WHERE cl.recording_url IS NOT NULL
      AND cl.recording_downloaded = FALSE
      AND cl.created_at > NOW() - INTERVAL '28 days'
    ORDER BY cl.created_at DESC
    LIMIT ${limit}
  `);

  for (const row of pending.rows) {
    await enqueue(RECORDING_QUEUE, {
      id: row.id, tenant_id: row.tenant_id, cdr_id: row.cdr_id, recording_url: row.recording_url,
    } as RecordingJob, { jobId: `rec:${row.id}` }); // dedupe: skip if a job for this recording is already queued
  }
}

async function downloadOne(
  callLogId: string,
  tenantId: string,
  cdrId: number,
  recordingUrl: string,
): Promise<void> {
  try {
    const resp = await fetch(recordingUrl, { signal: AbortSignal.timeout(30_000) });

    // URL expired or permanently gone — mark downloaded so we stop retrying
    if (resp.status === 403 || resp.status === 404 || resp.status === 410) {
      await query(
        `UPDATE call_logs SET recording_downloaded=TRUE WHERE id=$1`,
        [callLogId],
      );
      console.log(`[recordings] cdr=${cdrId}: URL expired (${resp.status}), skipped`);
      return;
    }

    if (!resp.ok) {
      // Transient error — leave recording_downloaded=FALSE and THROW so the queue
      // retries with backoff (and the 10-min poller re-picks it as a safety net).
      throw new Error(`[recordings] cdr=${cdrId}: HTTP ${resp.status}, will retry`);
    }

    const contentType = resp.headers.get('content-type') ?? '';
    const ext = contentType.includes('wav') ? '.wav' : '.mp3';
    const relPath = `${tenantId}/${callLogId}${ext}`;
    const fullPath = path.join(RECORDINGS_DIR, relPath);

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, Buffer.from(await resp.arrayBuffer()));

    await query(
      `UPDATE call_logs SET recording_downloaded=TRUE, recording_path=$1 WHERE id=$2`,
      [relPath, callLogId],
    );
    console.log(`[recordings] cdr=${cdrId}: saved → ${relPath}`);
  } catch (err: any) {
    // Network/timeout/transient — re-throw so the queue retries with backoff.
    // recording_downloaded stays FALSE, so the poller also re-picks it later.
    console.error(`[recordings] cdr=${cdrId}: ${err.message}`);
    throw err;
  }
}
