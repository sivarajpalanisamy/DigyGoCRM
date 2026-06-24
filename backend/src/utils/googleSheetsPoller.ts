import crypto from 'crypto';
import { query } from '../db';
import { triggerWorkflows } from '../routes/workflows';
import { upsertContact } from './contacts';
import { sendNewLeadNotification } from './notifications';
import { emitToTenant } from '../socket';
import { fetchPublicUrl, csvUrl, parseCsv, rowKey } from '../routes/google_sheets';
import { backfillCustomFields } from './customFields';
import { normalizePhone } from './phone';

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
  // Always skip the header row; identity-based dedup decides what's actually new.
  const dataRows = allRows.slice(1);

  if (dataRows.length === 0) return;

  const mapping: Record<string, any> = typeof config.column_mapping === 'object'
    ? config.column_mapping : {};
  const tenantId = config.tenant_id as string;
  // Custom-field mapping: { slug: sheetColumnHeader }
  const customMap: Record<string, string> = (mapping.custom && typeof mapping.custom === 'object') ? mapping.custom : {};

  const colIndex: Record<string, number> = {};
  headers.forEach((h: string, i: number) => { colIndex[h] = i; });

  const getByHeader = (row: string[], header: string): string => {
    if (!header) return '';
    const idx = colIndex[header];
    if (idx === undefined) return '';
    return (row[idx] ?? '').trim();
  };
  const getCell = (row: string[], crmField: string): string => getByHeader(row, mapping[crmField]);

  let processedCount = 0;
  for (const row of dataRows) {
    if (!row || row.every((c) => !c)) continue;

    const name   = getCell(row, 'name');
    // Normalize the phone defensively — clean cells pass through unchanged, dirty cells
    // (label prefixes like "p:", spaces, STD/00/missing country code) are cleaned to E.164.
    const rawPhone = getCell(row, 'phone');
    const phone  = rawPhone ? normalizePhone(rawPhone) : '';
    const email  = getCell(row, 'email');
    const source = getCell(row, 'source') || `Google Sheets: ${config.spreadsheet_name ?? config.spreadsheet_id}`;

    if (!name && !phone && !email) continue;

    // Content-based dedup: claim this row's identity key first. If it's already
    // recorded for this config, the row was imported before — skip it. This is
    // immune to row deletion, reordering, or the poller re-running.
    const key = rowKey(phone, email, row);
    let claimed = false;
    try {
      const claim = await query(
        `INSERT INTO google_sheets_imported_rows (config_id, row_key)
         VALUES ($1, $2) ON CONFLICT (config_id, row_key) DO NOTHING RETURNING id`,
        [config.id, key]
      );
      claimed = claim.rows.length > 0;
    } catch (err: any) {
      console.error(`[sheets poller] dedup claim error (config ${config.id}):`, err.message);
      continue;
    }
    if (!claimed) continue;

    const pipelineId = config.pipeline_id ?? null;
    const stageId = config.stage_id ?? null;

    try {
      let existingLead: any = null;
      if (phone) {
        // Match by last-10 digits, not exact string — a lead stored as "9876543210" and one
        // normalized to "+919876543210" are the SAME person. Exact-match dedup created dups.
        // Pipeline-scoped when config has a pipeline.
        const digits = phone.replace(/[^0-9]/g, '');
        const pipeFilter = pipelineId ? ` AND pipeline_id=$3::uuid` : '';
        const pipeParams = pipelineId ? [tenantId, digits.slice(-10), pipelineId] : [tenantId, digits.slice(-10)];
        const ex = digits.length >= 10
          ? await query(
              `SELECT * FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE
                 AND right(regexp_replace(phone,'[^0-9]','','g'),10)=$2${pipeFilter} LIMIT 1`,
              pipeParams
            )
          : await query(
              `SELECT * FROM leads WHERE tenant_id=$1 AND phone=$2 AND is_deleted=FALSE${pipeFilter} LIMIT 1`,
              pipelineId ? [tenantId, phone, pipelineId] : [tenantId, phone]
            );
        existingLead = ex.rows[0] ?? null;
      }
      if (!existingLead && email) {
        const pipeFilter = pipelineId ? ` AND pipeline_id=$3::uuid` : '';
        const ex = await query(
          `SELECT * FROM leads WHERE tenant_id=$1 AND LOWER(email)=LOWER($2) AND is_deleted=FALSE${pipeFilter} LIMIT 1`,
          pipelineId ? [tenantId, email, pipelineId] : [tenantId, email]
        );
        existingLead = ex.rows[0] ?? null;
      }

      const isDuplicate = !!existingLead;
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
          `INSERT INTO leads (tenant_id, name, email, phone, source, pipeline_id, stage_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [tenantId, name || email || phone, email || null, phone || null, source, pipelineId, stageId]
        );
        lead = insRes.rows[0];
        emitToTenant(tenantId, 'lead:created', lead);
        sendNewLeadNotification(tenantId, lead, null).catch(() => null);
      }

      // Log to enquiry_log
      query(
        `INSERT INTO enquiry_log (tenant_id, phone, email, lead_id, form_type, form_id, form_name, pipeline_id, pipeline_name, stage_id, stage_name, source, is_duplicate)
         VALUES ($1,$2,$3,$4,'google_sheets',$5,$6,$7,(SELECT name FROM pipelines WHERE id=$7::uuid),$8,(SELECT name FROM pipeline_stages WHERE id=$8::uuid),$9,$10)`,
        [tenantId, phone || null, email || null, lead.id, config.id, config.spreadsheet_name ?? config.spreadsheet_id,
         pipelineId, stageId, source, isDuplicate]
      ).catch((e: any) => console.error('[enquiry_log sheets]', e.message));

      // Extra mapped columns → custom fields (slug → value).
      const customData: Record<string, string> = {};
      for (const [slug, header] of Object.entries(customMap)) {
        const v = getByHeader(row, header);
        if (slug && v) customData[slug] = v;
      }
      if (Object.keys(customData).length) {
        await query(
          `UPDATE leads SET custom_fields = COALESCE(custom_fields,'{}')::jsonb || $1::jsonb, updated_at=NOW()
           WHERE id=$2 AND tenant_id=$3`,
          [JSON.stringify(customData), lead.id, tenantId]
        ).catch(() => null);
        lead.custom_fields = { ...(lead.custom_fields ?? {}), ...customData };
      }

      // Link the imported-row record to the resulting lead.
      await query(
        'UPDATE google_sheets_imported_rows SET lead_id=$1 WHERE config_id=$2 AND row_key=$3',
        [lead.id, config.id, key]
      ).catch(() => null);

      setImmediate(() => {
        upsertContact(tenantId, lead.name, lead.email, lead.phone, lead.id).catch(() => null);
        if (Object.keys(customData).length) {
          backfillCustomFields(lead.id, tenantId, customData).catch(() => null);
        }
        triggerWorkflows('sheets_row_added', lead, tenantId, '', {
          triggerContext: { configId: config.id },
        }).catch(() => null);
      });

      processedCount++;
    } catch (err: any) {
      console.error(`[sheets poller] Lead upsert error (config ${config.id}):`, err.message);
      // Release the claim so this row is retried on the next poll.
      await query(
        'DELETE FROM google_sheets_imported_rows WHERE config_id=$1 AND row_key=$2 AND lead_id IS NULL',
        [config.id, key]
      ).catch(() => null);
    }
  }

  // Informational only — reflects total rows currently in the sheet (no longer a cursor).
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
