import https from 'https';
import { query } from '../db';
import { triggerWorkflows } from '../routes/workflows';
import { upsertContact } from './contacts';
import { sendNewLeadNotification } from './notifications';
import { emitToTenant } from '../socket';

// ── HTTP helper (no extra deps) ───────────────────────────────────────────────

function googleGet(url: string, accessToken: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error(`Non-JSON from Google (${res.statusCode}): ${data.slice(0, 120)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ── Token refresh (self-contained to avoid circular imports) ──────────────────

async function refreshAccessToken(tenantId: string, refreshToken: string): Promise<string | null> {
  const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID ?? '';
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
  const postData = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: refreshToken, grant_type: 'refresh_token',
  }).toString();

  return new Promise((resolve) => {
    const req = https.request(
      { hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', async () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              console.error('[sheets poller] Token refresh error:', json.error);
              if (json.error === 'invalid_grant') {
                await query('UPDATE google_sheets_connections SET is_active=FALSE WHERE tenant_id=$1', [tenantId]).catch(() => null);
              }
              resolve(null);
              return;
            }
            const expiry = new Date(Date.now() + (json.expires_in ?? 3600) * 1000);
            await query(
              'UPDATE google_sheets_connections SET access_token=$1, token_expiry=$2 WHERE tenant_id=$3',
              [json.access_token, expiry, tenantId]
            ).catch(() => null);
            resolve(json.access_token);
          } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.write(postData);
    req.end();
  });
}

async function getToken(conn: { tenant_id: string; access_token: string | null; refresh_token: string; token_expiry: Date | null }): Promise<string | null> {
  if (conn.access_token && conn.token_expiry && new Date(conn.token_expiry) > new Date(Date.now() + 5 * 60_000)) {
    return conn.access_token;
  }
  return refreshAccessToken(conn.tenant_id, conn.refresh_token);
}

// ── Process one config row ────────────────────────────────────────────────────

async function processConfig(config: any, conn: any): Promise<void> {
  const accessToken = await getToken(conn);
  if (!accessToken) return;

  const startRow = config.last_row_synced + 1;
  const range = encodeURIComponent(`${config.sheet_name}!${startRow}:9999`);
  let result: any;
  try {
    result = await googleGet(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheet_id)}/values/${range}`,
      accessToken
    );
  } catch (err: any) {
    console.error(`[sheets poller] Read error for config ${config.id}:`, err.message);
    return;
  }

  // No new rows
  if (!result.values || result.values.length === 0) return;

  // Read header row to build column index map
  let headers: string[] = [];
  try {
    const hRes = await googleGet(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheet_id)}/values/${encodeURIComponent(config.sheet_name + '!1:1')}`,
      accessToken
    );
    headers = hRes.values?.[0] ?? [];
  } catch {
    return; // can't map without headers
  }

  const mapping: Record<string, string> = typeof config.column_mapping === 'object' ? config.column_mapping : {};
  const tenantId = config.tenant_id as string;

  // Build header → column index map
  const colIndex: Record<string, number> = {};
  headers.forEach((h: string, i: number) => { colIndex[h] = i; });

  // Helper: get cell value by CRM field key
  const getCell = (row: string[], crmField: string): string => {
    const sheetCol = mapping[crmField];
    if (!sheetCol) return '';
    const idx = colIndex[sheetCol];
    if (idx === undefined) return '';
    return (row[idx] ?? '').trim();
  };

  let processedCount = 0;
  for (const row of result.values as string[][]) {
    if (!row || row.length === 0) continue;

    const name   = getCell(row, 'name');
    const phone  = getCell(row, 'phone');
    const email  = getCell(row, 'email');
    const source = getCell(row, 'source') || `Google Sheets: ${config.spreadsheet_name ?? config.spreadsheet_id}`;

    if (!name && !phone && !email) continue; // empty row

    try {
      // Dedup: check if lead already exists by phone or email
      let existingLead: any = null;
      if (phone) {
        const ex = await query(
          'SELECT * FROM leads WHERE tenant_id=$1 AND phone=$2 AND is_deleted=FALSE LIMIT 1',
          [tenantId, phone]
        );
        existingLead = ex.rows[0] ?? null;
      }
      if (!existingLead && email) {
        const ex = await query(
          'SELECT * FROM leads WHERE tenant_id=$1 AND email=$2 AND is_deleted=FALSE LIMIT 1',
          [tenantId, email]
        );
        existingLead = ex.rows[0] ?? null;
      }

      let lead: any;
      if (existingLead) {
        // Enrich existing lead with any new data
        const updates: string[] = ['updated_at=NOW()'];
        const vals: any[] = [];
        if (email && !existingLead.email) { vals.push(email); updates.push(`email=$${vals.length}`); }
        if (phone && !existingLead.phone) { vals.push(phone); updates.push(`phone=$${vals.length}`); }
        vals.push(existingLead.id, tenantId);
        const upRes = await query(
          `UPDATE leads SET ${updates.join(',')} WHERE id=$${vals.length - 1} AND tenant_id=$${vals.length} RETURNING *`,
          vals
        );
        lead = upRes.rows[0];
        emitToTenant(tenantId, 'lead:updated', lead);
      } else {
        const insRes = await query(
          `INSERT INTO leads (tenant_id, name, email, phone, source)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [tenantId, name || email || phone, email || null, phone || null, source]
        );
        lead = insRes.rows[0];
        emitToTenant(tenantId, 'lead:created', lead);
        sendNewLeadNotification(tenantId, lead, null).catch(() => null);
      }

      const leadWithCtx = { ...lead, sheets_config_id: config.id };
      setImmediate(() => {
        upsertContact(tenantId, lead.name, lead.email, lead.phone, lead.id).catch(() => null);
        triggerWorkflows('sheets_row_added', leadWithCtx, tenantId, '', {
          triggerContext: { configId: config.id },
        }).catch(() => null);
      });

      processedCount++;
    } catch (err: any) {
      console.error(`[sheets poller] Lead upsert error (config ${config.id}):`, err.message);
    }
  }

  // Update last_row_synced
  const newLastRow = config.last_row_synced + (result.values as any[]).length;
  await query(
    'UPDATE google_sheets_configs SET last_row_synced=$1, updated_at=NOW() WHERE id=$2',
    [newLastRow, config.id]
  ).catch(() => null);

  if (processedCount > 0) {
    console.log(`[sheets poller] Config ${config.id} — processed ${processedCount} new lead(s)`);
  }
}

// ── Main poll function ────────────────────────────────────────────────────────

export async function pollGoogleSheets(): Promise<void> {
  let rows: any[];
  try {
    const res = await query(`
      SELECT c.*, conn.access_token, conn.refresh_token, conn.token_expiry
      FROM google_sheets_configs c
      JOIN google_sheets_connections conn ON conn.tenant_id = c.tenant_id AND conn.is_active = TRUE
      WHERE c.is_active = TRUE
    `);
    rows = res.rows;
  } catch (err: any) {
    if (err.code !== '42P01') {
      console.error('[sheets poller] DB error:', err.message);
    }
    return;
  }

  for (const row of rows) {
    try {
      await processConfig(row, row);
    } catch (err: any) {
      console.error(`[sheets poller] Config ${row.id} failed:`, err.message);
    }
  }
}
