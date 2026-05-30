import { Router, Response } from 'express';
import https from 'https';
import http from 'http';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

// Follow redirects and return response body as string
export function fetchPublicUrl(url: string, maxRedirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const get = parsed.protocol === 'https:' ? https.get : http.get;
    get(url, (res) => {
      if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (maxRedirects <= 0) { reject(new Error('Too many redirects')); return; }
        fetchPublicUrl(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode === 401 || res.statusCode === 403) {
        reject(new Error('Sheet is not publicly shared. Enable "Anyone with the link can view" in Google Sheets share settings.'));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Google returned HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Parse spreadsheet ID and GID from any Google Sheets URL
export function parseSheetUrl(rawUrl: string): { spreadsheetId: string; gid: string } | null {
  try {
    const match = rawUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) return null;
    const spreadsheetId = match[1];
    const gidMatch = rawUrl.match(/[#&?]gid=(\d+)/);
    return { spreadsheetId, gid: gidMatch ? gidMatch[1] : '0' };
  } catch {
    return null;
  }
}

// Build the public CSV export URL
export function csvUrl(spreadsheetId: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

// Parse a single CSV line (handles quoted fields)
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// Parse CSV string into rows
export function parseCsv(csv: string): string[][] {
  return csv.split('\n').map(parseCsvLine).filter((r) => r.some((c) => c.length > 0));
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/integrations/sheets/status
router.get('/status', requireAuth, requireTenant, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT id, spreadsheet_url, spreadsheet_id, gid, spreadsheet_name, sheet_name,
              column_mapping, last_row_synced, created_at
       FROM google_sheets_configs
       WHERE tenant_id=$1 AND is_active=TRUE ORDER BY created_at DESC`,
      [req.user!.tenantId]
    );
    res.json({ connected: result.rows.length > 0, configs: result.rows });
  } catch (err: any) {
    if (err.code === '42P01') { res.json({ connected: false, configs: [] }); return; }
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/integrations/sheets/preview — fetch headers from a public sheet URL
router.post('/preview', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { url } = req.body;
  if (!url?.trim()) { res.status(400).json({ error: 'url required' }); return; }

  const parsed = parseSheetUrl(url.trim());
  if (!parsed) {
    res.status(400).json({ error: 'Invalid Google Sheets URL. Copy the URL directly from your browser address bar.' });
    return;
  }

  try {
    const csv = await fetchPublicUrl(csvUrl(parsed.spreadsheetId, parsed.gid));
    const rows = parseCsv(csv);
    if (rows.length === 0) {
      res.status(400).json({ error: 'Sheet appears to be empty.' });
      return;
    }
    res.json({ headers: rows[0], spreadsheetId: parsed.spreadsheetId, gid: parsed.gid, rowCount: rows.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/integrations/sheets/configs — save a new sheet config
router.post('/configs', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { spreadsheet_url, spreadsheet_id, gid, spreadsheet_name, sheet_name, column_mapping } = req.body;
  if (!spreadsheet_url?.trim() || !spreadsheet_id?.trim()) {
    res.status(400).json({ error: 'spreadsheet_url and spreadsheet_id required' });
    return;
  }

  try {
    // Determine current row count so we only pick up NEW rows from this point
    let lastRow = 1;
    try {
      const csv = await fetchPublicUrl(csvUrl(spreadsheet_id.trim(), gid ?? '0'));
      const rows = parseCsv(csv);
      lastRow = Math.max(1, rows.length); // skip all existing rows
    } catch {}

    const result = await query(
      `INSERT INTO google_sheets_configs
         (tenant_id, spreadsheet_url, spreadsheet_id, gid, spreadsheet_name, sheet_name, column_mapping, last_row_synced)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.user!.tenantId,
        spreadsheet_url.trim(),
        spreadsheet_id.trim(),
        gid ?? '0',
        (spreadsheet_name ?? '').trim() || spreadsheet_id.trim(),
        (sheet_name ?? '').trim() || 'Sheet1',
        JSON.stringify(column_mapping ?? {}),
        lastRow,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    console.error('[google_sheets] configs POST error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/integrations/sheets/configs/:id
router.patch('/configs/:id', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { column_mapping, is_active, spreadsheet_name } = req.body;
  const fields: string[] = [];
  const params: any[] = [];

  if (column_mapping !== undefined)  { params.push(JSON.stringify(column_mapping)); fields.push(`column_mapping=$${params.length}`); }
  if (is_active !== undefined)       { params.push(is_active);                      fields.push(`is_active=$${params.length}`); }
  if (spreadsheet_name !== undefined){ params.push(spreadsheet_name);               fields.push(`spreadsheet_name=$${params.length}`); }

  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  fields.push('updated_at=NOW()');
  params.push(req.params.id, req.user!.tenantId);

  try {
    const result = await query(
      `UPDATE google_sheets_configs SET ${fields.join(',')} WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/integrations/sheets/configs/:id
router.delete('/configs/:id', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM google_sheets_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user!.tenantId]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/integrations/sheets/disconnect — deactivate all configs
router.delete('/disconnect', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query('UPDATE google_sheets_configs SET is_active=FALSE WHERE tenant_id=$1', [req.user!.tenantId]);
    res.json({ success: true });
  } catch (err: any) {
    if (err.code === '42P01') { res.json({ success: true }); return; }
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
