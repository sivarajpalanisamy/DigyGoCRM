import { Router, Response } from 'express';
import https from 'https';
import http from 'http';
import crypto from 'crypto';
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

// Build the public CSV URL. Uses the gviz endpoint, which reflects new rows much
// faster than /export?format=csv (the export endpoint caches aggressively).
export function csvUrl(spreadsheetId: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

// Fetch the human-readable spreadsheet title from the public edit page <title>.
// Returns null if it can't be determined (caller falls back to the ID).
export async function fetchSheetTitle(spreadsheetId: string): Promise<string | null> {
  try {
    const html = await fetchPublicUrl(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
    const m = html.match(/<title>([^<]*)<\/title>/i);
    if (!m) return null;
    const t = m[1].trim().replace(/\s*-\s*Google Sheets\s*$/i, '').trim();
    return t || null;
  } catch {
    return null;
  }
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

// Normalize a phone number to its digits only (for stable identity matching)
export function normalizePhone(p: string): string {
  return (p || '').replace(/\D/g, '');
}

// Stable identity key for a sheet row. Prefers phone, then email, then a hash of
// the whole row. Used for content-based dedup so deleting/reordering rows in the
// sheet never causes lost or duplicated leads.
export function rowKey(phone: string, email: string, row: string[]): string {
  const np = normalizePhone(phone);
  if (np) return `p:${np}`;
  const e = (email || '').trim().toLowerCase();
  if (e) return `e:${e}`;
  return `r:${crypto.createHash('sha1').update(row.join('')).digest('hex')}`;
}

// Convert a column header into a custom-field slug (matches customFields conventions)
export function slugify(s: string): string {
  const base = (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return base || 'field';
}

// Create custom-field definitions for any sheet columns the user mapped to a new
// custom field. Idempotent — existing slugs are left untouched.
async function ensureCustomFields(
  tenantId: string,
  fields: Array<{ name?: string; slug?: string; type?: string }>,
): Promise<void> {
  for (const f of fields) {
    const slug = (f.slug || slugify(f.name ?? '')).slice(0, 100);
    if (!slug) continue;
    const name = (f.name || slug).slice(0, 255);
    try {
      await query(
        `INSERT INTO custom_fields (tenant_id, name, type, slug, required)
         VALUES ($1,$2,$3,$4,false) ON CONFLICT (tenant_id, slug) DO NOTHING`,
        [tenantId, name, f.type || 'Single Line', slug],
      );
    } catch (err: any) {
      console.error('[google_sheets] ensureCustomFields', slug, err.message);
    }
  }
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
    const title = await fetchSheetTitle(parsed.spreadsheetId);
    res.json({ headers: rows[0], spreadsheetId: parsed.spreadsheetId, gid: parsed.gid, rowCount: rows.length, title });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/integrations/sheets/configs — save a new sheet config
router.post('/configs', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { spreadsheet_url, spreadsheet_id, gid, spreadsheet_name, sheet_name, column_mapping, create_fields } = req.body;
  if (!spreadsheet_url?.trim() || !spreadsheet_id?.trim()) {
    res.status(400).json({ error: 'spreadsheet_url and spreadsheet_id required' });
    return;
  }

  const tenantId = req.user!.tenantId!;
  const sid = spreadsheet_id.trim();
  const gidVal = (gid ?? '0').toString();
  const mapping: Record<string, any> = (column_mapping && typeof column_mapping === 'object') ? column_mapping : {};

  // Create any new custom fields the user mapped sheet columns to.
  if (Array.isArray(create_fields) && create_fields.length) {
    await ensureCustomFields(tenantId, create_fields);
  }

  try {
    // Reject connecting the same spreadsheet + tab twice (would double-process rows).
    const dup = await query(
      'SELECT id FROM google_sheets_configs WHERE tenant_id=$1 AND spreadsheet_id=$2 AND gid=$3 AND is_active=TRUE LIMIT 1',
      [tenantId, sid, gidVal]
    );
    if (dup.rows[0]) {
      res.status(409).json({ error: 'This sheet (and tab) is already connected.' });
      return;
    }

    const result = await query(
      `INSERT INTO google_sheets_configs
         (tenant_id, spreadsheet_url, spreadsheet_id, gid, spreadsheet_name, sheet_name, column_mapping, last_row_synced)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        tenantId,
        spreadsheet_url.trim(),
        sid,
        gidVal,
        (spreadsheet_name ?? '').trim() || sid,
        (sheet_name ?? '').trim() || 'Sheet1',
        JSON.stringify(mapping),
        0,
      ]
    );
    const cfg = result.rows[0];

    // Pre-seed all existing rows as already-imported, so only rows added AFTER
    // connecting will sync. Mirrors the previous "skip existing rows" behavior,
    // but using content-based keys instead of a fragile row count.
    try {
      const csv = await fetchPublicUrl(csvUrl(sid, gidVal));
      const rows = parseCsv(csv);
      if (rows.length > 1) {
        const headers = rows[0];
        const colIndex: Record<string, number> = {};
        headers.forEach((h, i) => { colIndex[h] = i; });
        const cell = (row: string[], field: string): string => {
          const col = mapping[field];
          if (!col) return '';
          const idx = colIndex[col];
          return idx === undefined ? '' : (row[idx] ?? '').trim();
        };

        const keys: string[] = [];
        const seen = new Set<string>();
        for (const row of rows.slice(1)) {
          if (!row || row.every((c) => !c)) continue;
          const k = rowKey(cell(row, 'phone'), cell(row, 'email'), row);
          if (seen.has(k)) continue;
          seen.add(k);
          keys.push(k);
        }

        // Chunked bulk insert (stay well under the Postgres parameter limit).
        for (let i = 0; i < keys.length; i += 500) {
          const batch = keys.slice(i, i + 500);
          const params: any[] = [];
          const values = batch.map((k) => {
            params.push(cfg.id, k);
            return `($${params.length - 1},$${params.length})`;
          });
          await query(
            `INSERT INTO google_sheets_imported_rows (config_id, row_key)
             VALUES ${values.join(',')} ON CONFLICT (config_id, row_key) DO NOTHING`,
            params
          );
        }
        await query('UPDATE google_sheets_configs SET last_row_synced=$1 WHERE id=$2', [rows.length, cfg.id]);
        cfg.last_row_synced = rows.length;
      }
    } catch (seedErr: any) {
      console.error('[google_sheets] pre-seed error:', seedErr.message);
    }

    res.status(201).json(cfg);
  } catch (err: any) {
    console.error('[google_sheets] configs POST error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/integrations/sheets/configs/:id
router.patch('/configs/:id', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { column_mapping, is_active, spreadsheet_name, create_fields } = req.body;
  const fields: string[] = [];
  const params: any[] = [];

  // Create any new custom fields referenced by an edited mapping.
  if (Array.isArray(create_fields) && create_fields.length) {
    await ensureCustomFields(req.user!.tenantId!, create_fields);
  }

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
