import { Router, Request, Response } from 'express';
import https from 'https';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';

const router = Router();

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const REDIRECT_URI  = `${process.env.WEBHOOK_BASE_URL ?? 'http://localhost:4000'}/api/integrations/sheets/callback`;
const FRONTEND_URL  = process.env.FRONTEND_URL ?? 'http://localhost:5173';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'email',
  'profile',
].join(' ');

// ── HTTP helpers ───────────────────────────────────────────────────────────────

function googleGet(url: string, accessToken: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Google API non-JSON response (${res.statusCode}): ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function googlePost(url: string, body: Record<string, string>): Promise<any> {
  const postData = new URLSearchParams(body).toString();
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Google token endpoint non-JSON')); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Token management ──────────────────────────────────────────────────────────

export async function getGoogleAccessToken(tenantId: string): Promise<string | null> {
  try {
    const res = await query(
      'SELECT access_token, refresh_token, token_expiry FROM google_sheets_connections WHERE tenant_id=$1 AND is_active=TRUE',
      [tenantId]
    );
    if (!res.rows[0]) return null;

    const { access_token, refresh_token, token_expiry } = res.rows[0];

    // Return existing token if still valid (5-minute buffer)
    if (access_token && token_expiry && new Date(token_expiry) > new Date(Date.now() + 5 * 60_000)) {
      return access_token;
    }

    // Refresh
    const tokenRes = await googlePost('https://oauth2.googleapis.com/token', {
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token,
      grant_type:    'refresh_token',
    });

    if (tokenRes.error) {
      console.error('[google_sheets] Token refresh failed:', tokenRes.error, tokenRes.error_description);
      // If refresh token is revoked, mark connection inactive
      if (tokenRes.error === 'invalid_grant') {
        await query('UPDATE google_sheets_connections SET is_active=FALSE WHERE tenant_id=$1', [tenantId]).catch(() => null);
      }
      return null;
    }

    const expiry = new Date(Date.now() + (tokenRes.expires_in ?? 3600) * 1000);
    await query(
      'UPDATE google_sheets_connections SET access_token=$1, token_expiry=$2 WHERE tenant_id=$3',
      [tokenRes.access_token, expiry, tenantId]
    );
    return tokenRes.access_token;
  } catch (err: any) {
    console.error('[google_sheets] getGoogleAccessToken error:', err.message);
    return null;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/integrations/sheets/oauth-url
router.get('/oauth-url', requireAuth, requireTenant, checkPermission('integrations:manage'), (req: AuthRequest, res: Response) => {
  if (!CLIENT_ID) {
    res.status(503).json({ error: 'Google Sheets integration not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env' });
    return;
  }

  const state = Buffer.from(JSON.stringify({ tenantId: req.user!.tenantId, userId: req.user!.userId })).toString('base64url');
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
    state,
  });

  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});

// GET /api/integrations/sheets/callback — public, no auth (Google redirects here)
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    res.redirect(`${FRONTEND_URL}/integrations?sheets_error=${encodeURIComponent(error)}`);
    return;
  }
  if (!code || !state) {
    res.redirect(`${FRONTEND_URL}/integrations?sheets_error=missing_params`);
    return;
  }

  try {
    const { tenantId } = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));

    const tokenRes = await googlePost('https://oauth2.googleapis.com/token', {
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    });

    if (tokenRes.error) {
      console.error('[google_sheets] Token exchange failed:', tokenRes.error, tokenRes.error_description);
      res.redirect(`${FRONTEND_URL}/integrations?sheets_error=token_exchange`);
      return;
    }

    let email = '';
    try {
      const userInfo = await googleGet('https://www.googleapis.com/oauth2/v3/userinfo', tokenRes.access_token);
      email = userInfo.email ?? '';
    } catch {}

    const expiry = new Date(Date.now() + (tokenRes.expires_in ?? 3600) * 1000);

    // Upsert — keep old refresh_token if new one wasn't issued (Google only re-issues with prompt=consent)
    await query(
      `INSERT INTO google_sheets_connections (tenant_id, access_token, refresh_token, token_expiry, email, is_active)
       VALUES ($1,$2,$3,$4,$5,TRUE)
       ON CONFLICT (tenant_id) DO UPDATE SET
         access_token  = $2,
         refresh_token = COALESCE($3, google_sheets_connections.refresh_token),
         token_expiry  = $4,
         email         = $5,
         is_active     = TRUE,
         connected_at  = NOW()`,
      [tenantId, tokenRes.access_token, tokenRes.refresh_token ?? null, expiry, email]
    );

    res.redirect(`${FRONTEND_URL}/integrations?sheets_connected=1`);
  } catch (err: any) {
    console.error('[google_sheets] Callback error:', err.message);
    res.redirect(`${FRONTEND_URL}/integrations?sheets_error=server_error`);
  }
});

// GET /api/integrations/sheets/status
router.get('/status', requireAuth, requireTenant, async (req: AuthRequest, res: Response) => {
  try {
    const connRes = await query(
      'SELECT email, connected_at, is_active FROM google_sheets_connections WHERE tenant_id=$1',
      [req.user!.tenantId]
    );
    const connected = connRes.rows[0]?.is_active === true;

    const configsRes = connected
      ? await query(
          `SELECT id, spreadsheet_id, spreadsheet_name, sheet_name, column_mapping, last_row_synced, created_at
           FROM google_sheets_configs WHERE tenant_id=$1 AND is_active=TRUE ORDER BY created_at DESC`,
          [req.user!.tenantId]
        )
      : { rows: [] };

    res.json({
      connected,
      email: connRes.rows[0]?.email ?? null,
      configs: configsRes.rows,
    });
  } catch (err: any) {
    if (err.code === '42P01') { res.json({ connected: false, email: null, configs: [] }); return; }
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/integrations/sheets/disconnect
router.delete('/disconnect', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  try {
    // Attempt to revoke the Google access token
    const tokenRes = await query(
      'SELECT access_token FROM google_sheets_connections WHERE tenant_id=$1',
      [req.user!.tenantId]
    );
    if (tokenRes.rows[0]?.access_token) {
      try {
        await googleGet(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenRes.rows[0].access_token)}`, '');
      } catch {}
    }

    await query('UPDATE google_sheets_connections SET is_active=FALSE WHERE tenant_id=$1', [req.user!.tenantId]);
    await query('UPDATE google_sheets_configs SET is_active=FALSE WHERE tenant_id=$1', [req.user!.tenantId]);

    res.json({ success: true });
  } catch (err: any) {
    if (err.code === '42P01') { res.json({ success: true }); return; }
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/integrations/sheets/list — list user's Google Spreadsheets via Drive API
router.get('/list', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const accessToken = await getGoogleAccessToken(req.user!.tenantId!);
  if (!accessToken) { res.status(401).json({ error: 'Not connected to Google Sheets' }); return; }

  try {
    const params = new URLSearchParams({
      q:        "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields:   'files(id,name,modifiedTime)',
      pageSize: '50',
      orderBy:  'modifiedTime desc',
    });
    const result = await googleGet(`https://www.googleapis.com/drive/v3/files?${params}`, accessToken);
    res.json({ files: result.files ?? [] });
  } catch (err: any) {
    console.error('[google_sheets] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/integrations/sheets/:spreadsheetId/tabs — list tabs in a spreadsheet
router.get('/:spreadsheetId/tabs', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const accessToken = await getGoogleAccessToken(req.user!.tenantId!);
  if (!accessToken) { res.status(401).json({ error: 'Not connected to Google Sheets' }); return; }

  try {
    const result = await googleGet(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(req.params.spreadsheetId)}?fields=sheets.properties`,
      accessToken
    );
    const tabs = (result.sheets ?? []).map((s: any) => ({
      id:   s.properties.sheetId,
      name: s.properties.title,
    }));
    res.json({ tabs });
  } catch (err: any) {
    console.error('[google_sheets] tabs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/integrations/sheets/:spreadsheetId/headers?sheet=SheetName — read first row (column headers)
router.get('/:spreadsheetId/headers', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { sheet } = req.query as Record<string, string>;
  if (!sheet) { res.status(400).json({ error: 'sheet query param required' }); return; }

  const accessToken = await getGoogleAccessToken(req.user!.tenantId!);
  if (!accessToken) { res.status(401).json({ error: 'Not connected to Google Sheets' }); return; }

  try {
    const range = encodeURIComponent(`${sheet}!1:1`);
    const result = await googleGet(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(req.params.spreadsheetId)}/values/${range}`,
      accessToken
    );
    res.json({ headers: (result.values?.[0] ?? []) as string[] });
  } catch (err: any) {
    console.error('[google_sheets] headers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/sheets/configs — create a new sheet sync config
router.post('/configs', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { spreadsheet_id, spreadsheet_name, sheet_name, column_mapping } = req.body;
  if (!spreadsheet_id?.trim() || !sheet_name?.trim()) {
    res.status(400).json({ error: 'spreadsheet_id and sheet_name required' });
    return;
  }

  try {
    // Read current row count so we only pick up NEW rows after setup
    let lastRow = 1;
    const accessToken = await getGoogleAccessToken(req.user!.tenantId!);
    if (accessToken) {
      try {
        const range = encodeURIComponent(`${sheet_name}!A:A`);
        const result = await googleGet(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheet_id)}/values/${range}`,
          accessToken
        );
        lastRow = Math.max(1, (result.values ?? []).length);
      } catch {}
    }

    const result = await query(
      `INSERT INTO google_sheets_configs (tenant_id, spreadsheet_id, spreadsheet_name, sheet_name, column_mapping, last_row_synced)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        req.user!.tenantId,
        spreadsheet_id.trim(),
        (spreadsheet_name ?? spreadsheet_id).trim(),
        sheet_name.trim(),
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

// PATCH /api/integrations/sheets/configs/:id — update column mapping or active state
router.patch('/configs/:id', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { column_mapping, is_active } = req.body;
  const fields: string[] = [];
  const params: any[] = [];

  if (column_mapping !== undefined) { params.push(JSON.stringify(column_mapping)); fields.push(`column_mapping=$${params.length}`); }
  if (is_active !== undefined)      { params.push(is_active);                     fields.push(`is_active=$${params.length}`); }

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

// DELETE /api/integrations/sheets/configs/:id — remove a sheet config
router.delete('/configs/:id', requireAuth, requireTenant, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM google_sheets_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user!.tenantId]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
