import { query } from '../db';
import { triggerWorkflows } from '../routes/workflows';
import { upsertContact } from './contacts';
import { sendNewLeadNotification } from './notifications';
import { emitToTenant } from '../socket';
import { fetchPublicUrl, csvUrl, parseCsv } from '../routes/google_sheets';

async function processConfig(config: any): Promise<void> {
  let allRows: string[][];
  try {
    const csv = await fetchPublicUrl(csvUrl(config.spreadsheet_id, config.gid ?? '0'));
    allRows = parseCsv(csv);
  } catch (err: any) {
    console.error(`[sheets poller] Fetch error for config ${config.id}:`, err.message);
    return;
  }

  if (allRows.length === 0) return;

  const headers = allRows[0];
  // last_row_synced tracks total rows (including header) already processed
  const newRows = allRows.slice(config.last_row_synced);

  if (newRows.length === 0) return;

  const mapping: Record<string, string> = typeof config.column_mapping === 'object'
    ? config.column_mapping : {};
  const tenantId = config.tenant_id as string;

  const colIndex: Record<string, number> = {};
  headers.forEach((h: string, i: number) => { colIndex[h] = i; });

  const getCell = (row: string[], crmField: string): string => {
    const sheetCol = mapping[crmField];
    if (!sheetCol) return '';
    const idx = colIndex[sheetCol];
    if (idx === undefined) return '';
    return (row[idx] ?? '').trim();
  };

  let processedCount = 0;
  for (const row of newRows) {
    if (!row || row.every((c) => !c)) continue;

    const name   = getCell(row, 'name');
    const phone  = getCell(row, 'phone');
    const email  = getCell(row, 'email');
    const source = getCell(row, 'source') || `Google Sheets: ${config.spreadsheet_name ?? config.spreadsheet_id}`;

    if (!name && !phone && !email) continue;

    try {
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

      setImmediate(() => {
        upsertContact(tenantId, lead.name, lead.email, lead.phone, lead.id).catch(() => null);
        triggerWorkflows('sheets_row_added', lead, tenantId, '', {
          triggerContext: { configId: config.id },
        }).catch(() => null);
      });

      processedCount++;
    } catch (err: any) {
      console.error(`[sheets poller] Lead upsert error (config ${config.id}):`, err.message);
    }
  }

  await query(
    'UPDATE google_sheets_configs SET last_row_synced=$1, updated_at=NOW() WHERE id=$2',
    [allRows.length, config.id]
  ).catch(() => null);

  if (processedCount > 0) {
    console.log(`[sheets poller] Config ${config.id} — processed ${processedCount} new lead(s)`);
  }
}

export async function pollGoogleSheets(): Promise<void> {
  let rows: any[];
  try {
    const res = await query('SELECT * FROM google_sheets_configs WHERE is_active=TRUE');
    rows = res.rows;
  } catch (err: any) {
    if (err.code !== '42P01') {
      console.error('[sheets poller] DB error:', err.message);
    }
    return;
  }

  for (const row of rows) {
    try {
      await processConfig(row);
    } catch (err: any) {
      console.error(`[sheets poller] Config ${row.id} failed:`, err.message);
    }
  }
}
