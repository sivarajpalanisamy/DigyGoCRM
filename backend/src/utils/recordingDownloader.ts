import fs from 'fs';
import path from 'path';
import { query } from '../db';

export const RECORDINGS_DIR = process.env.RECORDINGS_DIR ?? '/var/www/digygocrm/recordings';

/**
 * Background worker — runs every 10 minutes.
 * Downloads up to 10 pending call recordings from Superfone before the 30-day URL expiry.
 * Stores files at {RECORDINGS_DIR}/{tenantId}/{callLogId}.mp3
 */
export async function processRecordingDownloads(): Promise<void> {
  const pending = await query(`
    SELECT id, tenant_id, cdr_id, recording_url
    FROM call_logs
    WHERE recording_url IS NOT NULL
      AND recording_downloaded = FALSE
      AND created_at > NOW() - INTERVAL '28 days'
    ORDER BY created_at DESC
    LIMIT 10
  `);

  for (const row of pending.rows) {
    await downloadOne(row.id, row.tenant_id, row.cdr_id, row.recording_url);
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
      // Transient error — leave recording_downloaded=FALSE, will retry next cycle
      console.error(`[recordings] cdr=${cdrId}: HTTP ${resp.status}, will retry`);
      return;
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
    console.error(`[recordings] cdr=${cdrId}: ${err.message}`);
  }
}
