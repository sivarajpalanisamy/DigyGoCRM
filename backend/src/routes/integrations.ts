import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../db';
import { requireAuth, requireSuperfone, AuthRequest } from '../middleware/auth';
import { checkPermission } from '../middleware/permissions';
import { encrypt, decrypt } from '../utils/crypto';
import { parseMetaFieldData } from '../utils/meta';
import { triggerWorkflows, executeNodes, enrichLead } from './workflows';
import { sendNewLeadNotification, sendIntegrationAlert } from '../utils/notifications';
import { emitLeadCreated } from '../utils/leadEvents';
import https from 'https';

const router = Router();

// Upsert a contact record linked to a lead — idempotent, safe to call multiple times.
// Ensures Meta Form leads are visible in the Contacts page even when automation fails.
async function upsertContact(tenantId: string, leadRow: any): Promise<void> {
  if (!leadRow?.id || !leadRow?.name) return;
  await query(
    `INSERT INTO contacts (tenant_id, name, email, phone, lead_id)
     SELECT $1::uuid, $2, $3, $4, $5::uuid
     WHERE NOT EXISTS (
       SELECT 1 FROM contacts WHERE lead_id = $5::uuid
     )`,
    [tenantId, leadRow.name, leadRow.email ?? null, leadRow.phone ?? null, leadRow.id]
  ).catch(() => null);
}


function graphGet(path: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const sep = path.includes('?') ? '&' : '?';
    const url = `https://graph.facebook.com/v21.0${path}${token ? `${sep}access_token=${token}` : ''}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    }).on('error', reject);
  });
}

// Fetch ALL pages from a paginated Graph API endpoint (handles cursor pagination)
async function graphGetAll(path: string, token: string): Promise<any[]> {
  const results: any[] = [];
  // Request max limit=100 to reduce round trips
  const sep = path.includes('?') ? '&' : '?';
  let nextPath: string | null = `${path}${sep}limit=100`;

  while (nextPath) {
    const data = await graphGet(nextPath, token);
    if (data.error) throw new Error(data.error.message);
    results.push(...(data.data ?? []));
    // Extract next page cursor path if exists
    const nextUrl: string | undefined = data.paging?.next;
    if (nextUrl) {
      try {
        const parsed = new URL(nextUrl);
        parsed.searchParams.delete('access_token');
        // Build path + remaining query string (without the token)
        nextPath = `${parsed.pathname.replace(/^\/v[\d.]+/, '')}${parsed.search}`;
      } catch {
        nextPath = null;
      }
    } else {
      nextPath = null;
    }
  }
  return results;
}

interface PageResult {
  id: string;
  name: string;
  access_token: string;
}

// Fetch all pages a token can access — personal + Business Manager owned + client pages.
// Returns { connected: pages with token, needsToken: pages found but no token available }
async function fetchAllPages(token: string): Promise<{
  connected: PageResult[];
  needsToken: Array<{ id: string; name: string }>;
}> {
  const connected: PageResult[] = await graphGetAll('/me/accounts?fields=id,name,access_token', token);
  const needsToken: Array<{ id: string; name: string }> = [];

  try {
    const businesses = await graphGetAll('/me/businesses?fields=id,name', token);
    for (const biz of businesses) {
      const [owned, client] = await Promise.all([
        graphGetAll(`/${biz.id}/owned_pages?fields=id,name,access_token`, token).catch(() => [] as any[]),
        graphGetAll(`/${biz.id}/client_pages?fields=id,name,access_token`, token).catch(() => [] as any[]),
      ]);
      for (const p of [...owned, ...client]) {
        const alreadyConnected = connected.find((x) => x.id === p.id);
        if (alreadyConnected) continue;
        if (p.access_token) {
          connected.push({ id: p.id, name: p.name, access_token: p.access_token });
        } else {
          // Found via BM but Facebook didn't issue a page token for this user.
          // Surface to the frontend so user can manually paste the page token.
          needsToken.push({ id: p.id, name: p.name });
        }
      }
    }
  } catch { /* Business Manager not available */ }

  return { connected, needsToken };
}

// Build a pageId→pageToken map from the user token so lead fetches use page tokens.
// Meta requires a Page Access Token (not a User Access Token) for /{formId}/leads.
// Uses fetchAllPages so BM-owned and client pages are also covered, not just /me/accounts.
// Falls back gracefully — callers use the user token for any page not in the map.
async function buildPageTokenMap(userToken: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { connected } = await fetchAllPages(userToken);
    for (const p of connected) {
      if (p.access_token) map.set(p.id, p.access_token);
    }
  } catch { /* network issue — callers fall back to user token */ }
  return map;
}

function parseMetaTimestamp(raw: unknown): string {
  if (!raw) return new Date().toISOString();
  const asNum = Number(raw);
  if (!isNaN(asNum) && asNum > 1000000) return new Date(asNum * 1000).toISOString();
  const parsed = new Date(raw as string);
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function graphPost(path: string, token: string, body: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ ...body, access_token: token }).toString();
    const options = {
      hostname: 'graph.facebook.com',
      path: `/v21.0${path}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.write(params);
    req.end();
  });
}

// Meta API returns questions as a connection { data: [...] } OR a plain array
function extractQuestions(qs: any): any[] {
  if (Array.isArray(qs)) return qs;
  if (qs?.data && Array.isArray(qs.data)) return qs.data;
  return [];
}

// Standard field auto-mapping rules
// Leak 1 fix: first_name/last_name map to their own CRM fields so parseMetaFieldData
// can concatenate them correctly — previously both mapped to 'name', last-name-only.
const AUTO_MAP: Record<string, string> = {
  full_name: 'name', first_name: 'first_name', last_name: 'last_name',
  email: 'email', email_address: 'email',
  phone_number: 'phone', phone: 'phone', mobile: 'phone', mobile_phone: 'phone',
};

// ── Shared helper: sync forms for one page + cache questions + auto-map ───────
async function syncPageForms(
  tenantId: string,
  page: { id: string; name: string; access_token: string }
): Promise<number> {
  // Let errors propagate — callers handle per-page failures individually
  const metaForms: Array<{ id: string; name: string; status?: string }> = await graphGetAll(
    `/${page.id}/leadgen_forms?fields=id,name,status`,
    page.access_token
  );
  for (const form of metaForms) {
    const metaStatus = (form.status ?? 'ACTIVE').toUpperCase();
    await query(
      `INSERT INTO meta_forms (tenant_id, page_id, page_name, form_id, form_name, is_active, meta_status)
       VALUES ($1,$2,$3,$4,$5,FALSE,$6)
       ON CONFLICT (tenant_id, form_id) DO UPDATE SET form_name=$5, page_name=$3, meta_status=$6`,
      [tenantId, page.id, page.name, form.id, form.name, metaStatus]
    );
    // Fetch and cache questions, then auto-apply field mapping
    try {
      const detail = await graphGet(`/${form.id}?fields=questions,name`, page.access_token);
      if (!detail.error) {
        const qs = extractQuestions(detail.questions);
        await query(
          'UPDATE meta_forms SET questions=$1::jsonb WHERE tenant_id=$2 AND form_id=$3',
          [JSON.stringify(qs), tenantId, form.id]
        ).catch(() => null);

        // Auto-apply field mapping for known fields (only if not already mapped)
        const autoMapping = qs
          .filter((q: any) => AUTO_MAP[q.key])
          .map((q: any) => ({ fb_field: q.key, crm_field: AUTO_MAP[q.key] }));
        if (autoMapping.length > 0) {
          await query(
            `UPDATE meta_forms SET field_mapping=$1::jsonb
             WHERE tenant_id=$2 AND form_id=$3
             AND (field_mapping IS NULL OR field_mapping='[]'::jsonb OR field_mapping='null'::jsonb)`,
            [JSON.stringify(autoMapping), tenantId, form.id]
          ).catch(() => null);
        }
      }
    } catch { /* questions unavailable — skip */ }
  }
  return metaForms.length;
}

// ── Shared helper: store custom field values for a lead ───────────────────────
async function storeCustomValues(
  leadId: string,
  tenantId: string,
  customValues: Record<string, string>
): Promise<void> {
  for (const [slug, value] of Object.entries(customValues)) {
    if (!value) continue;
    let cfRes = await query(
      'SELECT id FROM custom_fields WHERE tenant_id=$1 AND slug=$2 LIMIT 1',
      [tenantId, slug]
    );
    if (!cfRes.rows[0]) {
      // Auto-create the custom field so mapped values are never silently dropped
      const fieldName = slug.split(/[_\-]+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      try {
        const ins = await query(
          `INSERT INTO custom_fields (tenant_id, name, type, slug, required)
           VALUES ($1,$2,'Single Line',$3,false) RETURNING id`,
          [tenantId, fieldName, slug]
        );
        cfRes = ins;
      } catch {
        cfRes = await query('SELECT id FROM custom_fields WHERE tenant_id=$1 AND slug=$2 LIMIT 1', [tenantId, slug]);
      }
    }
    if (cfRes.rows[0]?.id) {
      await query(
        `INSERT INTO lead_field_values (lead_id, tenant_id, field_id, value)
         VALUES ($1,$2,$3,$4) ON CONFLICT (lead_id, field_id) DO UPDATE SET value=$4, updated_at=NOW()`,
        [leadId, tenantId, cfRes.rows[0].id, value]
      );
    }
  }
}

// ── Shared helper: fetch all leads from Meta and insert into CRM ──────────────
// Processes ALL active forms in parallel — one form failing never blocks another.
async function fetchAndInsertAllLeads(tenantId: string, token: string): Promise<number> {
  const formsRes = await query(
    `SELECT id, form_id, form_name, field_mapping, pipeline_id, stage_id, page_id
     FROM meta_forms WHERE tenant_id=$1 AND is_active=TRUE`,
    [tenantId]
  );

  const pageTokenMap = await buildPageTokenMap(token);

  // Process every form in parallel; errors are isolated per form
  const results = await Promise.allSettled(
    formsRes.rows.map(async (mf: any) => {
      const leadToken = pageTokenMap.get(mf.page_id) ?? token;
      const allLeads = await graphGetAll(
        `/${mf.form_id}/leads?fields=id,created_time,field_data`,
        leadToken
      );
      console.log(`[fetchAndInsertAllLeads] form ${mf.form_id}: ${allLeads.length} leads`);

      const mapping: Array<{ fb_field: string; crm_field: string }> = mf.field_mapping ?? [];
      if (mapping.length === 0) {
        console.log(`[fetchAndInsertAllLeads] skipping form ${mf.form_id} — no field mapping configured yet`);
        return 0;
      }

      // Process each lead in this form — also in parallel
      const leadResults = await Promise.allSettled(
        allLeads.map(async (leadEntry: any) => {
          const leadgenId: string = leadEntry.id;
          if (!leadgenId) return 0;

          // 1. Parse + normalize fields
          const { name, email, phone, customValues } = parseMetaFieldData(
            leadEntry.field_data ?? [],
            mapping
          );

          // 2. Check by source_ref — restore if soft-deleted (tenant-scoped to prevent cross-tenant skip)
          const idem = await query(
            `SELECT id, is_deleted FROM leads WHERE tenant_id=$1 AND source='meta_form' AND source_ref=$2 LIMIT 1`,
            [tenantId, leadgenId]
          );
          if (idem.rows[0]) {
            if (idem.rows[0].is_deleted) {
              await query(`UPDATE leads SET is_deleted=FALSE, updated_at=NOW() WHERE id=$1`, [idem.rows[0].id]).catch(() => null);
              return 1;
            }
            return 0; // already active
          }

          // 3. Email/phone dedup — scoped to the form's pipeline (multi-pipeline: a contact may
          //    exist once per pipeline). Phone/email-only when the form has no pipeline.
          const existing = (email || phone) ? await query(
            `SELECT id FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE
             AND (($2::text<>'' AND LOWER(email)=$2) OR ($3::text<>'' AND phone=$3))
             AND ($4::uuid IS NULL OR pipeline_id = $4::uuid) LIMIT 1`,
            [tenantId, email, phone, mf.pipeline_id ?? null]
          ) : { rows: [] };
          if (existing.rows[0]) return 0;

          const createdAt = parseMetaTimestamp(leadEntry.created_time);

          // 4. Insert new lead
          const newLead = await query(
            `INSERT INTO leads (tenant_id, name, email, phone, source, source_ref, meta_form_id, pipeline_id, stage_id, created_at, meta_created_at)
             VALUES ($1,$2,$3,$4,'meta_form',$5,$6,$7,$8,$9,$9) RETURNING *`,
            [tenantId, name, email, phone, leadgenId, mf.form_id, mf.pipeline_id ?? null, mf.stage_id ?? null, createdAt]
          );
          const newLeadRow = newLead.rows[0];
          if (!newLeadRow) return 0;

          if (Object.keys(customValues).length > 0) {
            await storeCustomValues(newLeadRow.id, tenantId, customValues).catch(() => null);
          }
          // Bulk historical import is SILENT: insert only — no automation replay, no notification.
          return 1;
        })
      );

      const insertedForForm = leadResults.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);
      leadResults.filter((r) => r.status === 'rejected').forEach((r: any) =>
        console.error(`[fetchAndInsertAllLeads] lead error in form ${mf.form_id}:`, r.reason?.message)
      );

      // Always refresh count after processing
      await query(
        `UPDATE meta_forms SET leads_count=(SELECT COUNT(*) FROM leads WHERE meta_form_id=$1 AND tenant_id=$2 AND is_deleted=FALSE), last_sync_at=NOW() WHERE id=$3`,
        [mf.form_id, tenantId, mf.id]
      ).catch(() => null);

      return insertedForForm;
    })
  );

  // Log any form-level failures
  results.filter((r) => r.status === 'rejected').forEach((r: any) =>
    console.error(`[fetchAndInsertAllLeads] form-level error:`, r.reason?.message)
  );

  return results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);
}

// ── META PUBLIC: webhook + OAuth callback (no auth required) ─────────────────

// GET /api/integrations/meta/webhook — Meta challenge verification
router.get('/meta/webhook', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// POST /api/integrations/meta/webhook — receive lead-gen events
router.post('/meta/webhook', async (req: Request, res: Response) => {
  // Leak 7 fix: reject if META_APP_SECRET is not configured — never process unverified webhooks
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) { res.status(401).send('Webhook secret not configured'); return; }
  const sig = req.headers['x-hub-signature-256'] as string | undefined;
  if (!sig) { res.status(401).send('Missing x-hub-signature-256 header'); return; }
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.body as Buffer).digest('hex');
  if (sig !== expected) { res.status(401).send('Invalid signature'); return; }

  let body: any;
  try { body = JSON.parse((req.body as Buffer).toString()); } catch { res.status(400).send('Bad JSON'); return; }

  res.status(200).send('EVENT_RECEIVED'); // respond immediately per Meta requirements

  // Process async — Meta requires 200 within 5s or it retries (causing duplicates)
  // All entries and changes run in parallel; each lead is fully isolated
  setImmediate(async () => {
    const allChanges: Array<{ pageId: string; metaFormId: string; leadgenId: string }> = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'leadgen') continue;
        const { form_id: metaFormId, leadgen_id: leadgenId } =
          change.value as { form_id: string; leadgen_id: string };
        if (leadgenId && metaFormId) allChanges.push({ pageId: entry.id, metaFormId, leadgenId });
      }
    }

    // Leadgen fetches require a PAGE token — a user token returns #190 and the lead is dropped.
    // Derive page tokens once per tenant and reuse them across this webhook batch.
    const pageTokenCache = new Map<string, Map<string, string>>(); // tenantId -> (pageId -> pageToken)

    await Promise.allSettled(allChanges.map(async ({ pageId, metaFormId, leadgenId }) => {
      try {

          // 1. Fast idempotency check — skip if this exact leadgen_id already processed
          const idem = await query(
            `SELECT id FROM leads WHERE source='meta_form' AND source_ref=$1 LIMIT 1`,
            [leadgenId]
          );
          if (idem.rows[0]) return;

          // Find tenant by page_id
          const miRes = await query(
            `SELECT * FROM meta_integrations WHERE page_ids @> $1::jsonb LIMIT 1`,
            [JSON.stringify([pageId])]
          );
          const mi = miRes.rows[0];
          if (!mi) return;

          // Auto-create form entry if first time seeing this form_id
          await query(
            `INSERT INTO meta_forms (tenant_id, page_id, page_name, form_id, form_name, is_active)
             VALUES ($1,$2,'',$3,'',FALSE)
             ON CONFLICT (tenant_id, form_id) DO NOTHING`,
            [mi.tenant_id, pageId, metaFormId]
          );

          const mfRes = await query(
            `SELECT * FROM meta_forms WHERE tenant_id=$1 AND form_id=$2 LIMIT 1`,
            [mi.tenant_id, metaFormId]
          );
          const mf = mfRes.rows[0];
          if (!mf) return;
          // Leak 6 fix: log instead of silently dropping leads for deactivated forms
          if (!mf.is_active) {
            console.warn(`[Meta webhook] leadgen ${leadgenId} dropped — form ${metaFormId} is deactivated for tenant ${mi.tenant_id}`);
            return;
          }

          // Use the PAGE token for this page — fetching leadgen with the user token returns #190.
          const userToken = decrypt(mi.access_token);
          let ptMap = pageTokenCache.get(mi.tenant_id);
          if (!ptMap) {
            ptMap = await buildPageTokenMap(userToken).catch(() => new Map<string, string>());
            pageTokenCache.set(mi.tenant_id, ptMap);
          }
          const token = (pageId && ptMap.get(pageId)) || userToken; // fall back to user token only if no page token

          // 2. Fetch field_data (+ created_time for the original submission timestamp) from Meta
          const leadData = await graphGet(`/${leadgenId}?fields=created_time,field_data`, token);
          // Leak 1 fix: expired/invalid token returns error — skip rather than insert a blank lead
          if (leadData.error) {
            console.error(`[Meta webhook] Graph API error for leadgen ${leadgenId}:`, leadData.error.message ?? leadData.error);
            return; // poll worker will retry on next cycle
          }
          const fieldData: Array<{ name: string; values: string[] }> = leadData.field_data ?? [];

          // 3. Guard: skip lead if no field mapping has been configured yet
          const mapping: Array<{ fb_field: string; crm_field: string }> = mf.field_mapping ?? [];
          if (mapping.length === 0) {
            console.warn(`[Meta webhook] leadgen ${leadgenId} skipped — form ${metaFormId} has no field mapping. Configure mapping to start importing leads.`);
            return;
          }

          // Parse + normalize using shared utility (phone normalized, email lowercased)
          const { name, email, phone, customValues } = parseMetaFieldData(fieldData, mapping);

          // 4. Email/phone dedup — scoped to the form's pipeline (multi-pipeline support).
          //    A submission for a different pipeline creates a new lead instead of updating.
          const existing = (email || phone) ? await query(
            `SELECT id FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE
             AND (($2::text<>'' AND LOWER(email)=$2) OR ($3::text<>'' AND phone=$3))
             AND ($4::uuid IS NULL OR pipeline_id = $4::uuid) LIMIT 1`,
            [mf.tenant_id, email, phone, mf.pipeline_id ?? null]
          ) : { rows: [] };

          let leadId: string | null = null;
          let isNew = false;

          if (existing.rows[0]) {
            leadId = existing.rows[0].id;
            // Fill any blank fields with richer data from this submission
            const updated = await query(
              `UPDATE leads SET
                 name         = CASE WHEN (name=''  OR name  IS NULL) THEN $2 ELSE name  END,
                 email        = CASE WHEN (email='' OR email IS NULL) AND $3<>'' THEN $3 ELSE email END,
                 phone        = CASE WHEN (phone='' OR phone IS NULL) AND $4<>'' THEN $4 ELSE phone END,
                 source_ref   = COALESCE(source_ref, $5),
                 meta_form_id = COALESCE(meta_form_id, $6),
                 updated_at   = NOW()
               WHERE id=$1 RETURNING *`,
              [leadId, name, email, phone, leadgenId, mf.form_id]
            );

            // Detect which custom fields changed before storeCustomValues overwrites them
            const changedFields: string[] = [];
            for (const [slug, newVal] of Object.entries(customValues)) {
              if (!newVal) continue;
              const prev = await query(
                `SELECT lfv.value FROM lead_field_values lfv
                 JOIN custom_fields cf ON cf.id = lfv.field_id
                 WHERE lfv.lead_id=$1 AND cf.tenant_id=$2 AND cf.slug=$3 LIMIT 1`,
                [leadId, mf.tenant_id, slug]
              ).catch(() => ({ rows: [] as any[] }));
              const oldVal = prev.rows[0]?.value;
              if (oldVal !== undefined && oldVal !== String(newVal)) {
                changedFields.push(`${slug}: "${oldVal}" → "${newVal}"`);
              }
            }

            // Always create a note so CRM staff can see re-submission history
            const noteTitle = changedFields.length > 0
              ? `Re-submitted via "${mf.form_name}" — ${changedFields.length} field(s) changed`
              : `Re-submitted via "${mf.form_name}"`;
            const noteContent = changedFields.length > 0
              ? `Changed: ${changedFields.join(', ')}`
              : `No field changes — same data as previous submission.`;
            await query(
              `INSERT INTO lead_notes (lead_id, tenant_id, title, content) VALUES ($1,$2,$3,$4)`,
              [leadId, mf.tenant_id, noteTitle, noteContent]
            ).catch(() => null);

            const dataChanged = changedFields.length > 0;
            const existingCtx = { ...(updated.rows[0] ?? existing.rows[0]), form_id: mf.form_id, form_name: mf.form_name };
            upsertContact(mf.tenant_id, existingCtx).catch(() => null);
            // Force re-entry only when field data actually changed — new pincode triggers fresh routing
            setImmediate(() => triggerWorkflows('meta_form', existingCtx, mf.tenant_id, 'webhook', { forceReEntry: dataChanged }).catch((e) => console.error('[webhook trigger existing]', e)));
          } else {
            isNew = true;
            const metaCreatedIso = leadData.created_time ? parseMetaTimestamp(leadData.created_time) : null;
            // Insert with leadgen_id as source_ref — guarantees idempotency on re-delivery.
            // created_at stays NOW() (real-time arrival); meta_created_at records the Meta submission time.
            const ins = await query(
              `INSERT INTO leads (tenant_id, name, email, phone, source, source_ref, meta_form_id, pipeline_id, stage_id, meta_created_at)
               VALUES ($1,$2,$3,$4,'meta_form',$5,$6,$7,$8,$9) RETURNING *`,
              [mf.tenant_id, name, email, phone, leadgenId, mf.form_id, mf.pipeline_id ?? null, mf.stage_id ?? null, metaCreatedIso]
            );
            leadId = ins.rows[0]?.id;
            if (ins.rows[0]) {
              const leadCtx = { ...ins.rows[0], form_id: mf.form_id, form_name: mf.form_name };
              upsertContact(mf.tenant_id, ins.rows[0]).catch(() => null);
              sendNewLeadNotification(mf.tenant_id, ins.rows[0], null).catch(() => null);
              emitLeadCreated(mf.tenant_id, ins.rows[0].id).catch(() => null);
              setImmediate(() => triggerWorkflows('lead_created', leadCtx, mf.tenant_id, 'webhook').catch((e) => console.error('[webhook trigger new]', e)));
              setImmediate(() => triggerWorkflows('meta_form',    leadCtx, mf.tenant_id, 'webhook').catch((e) => console.error('[webhook trigger new]', e)));
            }
          }

          // 5. Store custom field values
          if (leadId && Object.keys(customValues).length > 0) {
            await storeCustomValues(leadId, mf.tenant_id, customValues).catch(() => null);
          }

          // 6. Update form stats — only increment for new leads
          if (isNew) {
            await query(`UPDATE meta_forms SET leads_count=leads_count+1, last_sync_at=NOW() WHERE id=$1`, [mf.id]).catch(() => null);
          } else {
            await query(`UPDATE meta_forms SET last_sync_at=NOW() WHERE id=$1`, [mf.id]).catch(() => null);
          }
      } catch (err) { console.error(`[Meta webhook] error for leadgen ${leadgenId}:`, err); }
    }));
  });
});

// GET /api/integrations/meta/callback — OAuth redirect from Meta (no auth)
router.get('/meta/callback', async (req: Request, res: Response) => {
  const { code, state: tenantId } = req.query as { code?: string; state?: string };
  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const baseUrl   = process.env.WEBHOOK_BASE_URL ?? 'http://localhost:5173';
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

  if (!code || !tenantId) {
    res.redirect(`${frontendUrl}/lead-generation/meta-forms?error=missing_params`); return;
  }
  if (!appId || !appSecret) {
    res.redirect(`${frontendUrl}/lead-generation/meta-forms?error=not_configured`); return;
  }

  console.log('[META CONNECT] callback hit — appId:', appId, 'tenantId:', tenantId);
  try {
    const redirectUri = encodeURIComponent(`${baseUrl}/api/integrations/meta/callback`);
    console.log('[META CONNECT] redirect_uri:', decodeURIComponent(redirectUri));

    const shortData = await graphGet(
      `/oauth/access_token?client_id=${appId}&redirect_uri=${redirectUri}&client_secret=${appSecret}&code=${code}`, ''
    );
    console.log('[META CONNECT] short token response:', JSON.stringify(shortData));
    if (shortData.error) throw new Error('Short token error: ' + shortData.error.message);

    const longData = await graphGet(
      `/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortData.access_token}`, ''
    );
    console.log('[META CONNECT] long token response:', JSON.stringify({ ...longData, access_token: '***' }));
    if (longData.error) throw new Error('Long token error: ' + longData.error.message);

    const expiry = longData.expires_in ? new Date(Date.now() + longData.expires_in * 1000) : null;
    const userToken: string = longData.access_token;
    const encrypted = encrypt(userToken);

    // Debug: log what permissions were actually granted
    const permData = await graphGet('/me/permissions', userToken).catch(() => ({ data: [] }));
    const grantedPerms = (permData.data ?? []).filter((p: any) => p.status === 'granted').map((p: any) => p.permission);
    console.log('[META CONNECT] granted permissions:', grantedPerms);

    // Fetch ALL pages — personal + Business Manager owned + client pages
    const { connected: pages, needsToken: blockedPages } = await fetchAllPages(userToken);
    console.log('[META CONNECT] connected pages:', pages.length, '| needs token:', blockedPages.length);

    if (pages.length === 0 && blockedPages.length === 0) {
      const hasPagesList = grantedPerms.includes('pages_show_list');
      console.warn('[META CONNECT] No pages returned — pages_show_list granted:', hasPagesList);
      res.redirect(`${frontendUrl}/lead-generation/meta-forms?error=no_pages_found`);
      return;
    }

    const newPageIds = pages.map((p) => p.id);
    for (const page of pages) {
      await graphPost(`/${page.id}/subscribed_apps`, page.access_token, { subscribed_fields: 'leadgen' }).catch(() => null);
    }

    // Merge connected pages with existing
    const existing = await query('SELECT page_ids, page_names FROM meta_integrations WHERE tenant_id=$1', [tenantId]);
    const existingIds: string[] = existing.rows[0]?.page_ids ?? [];
    const existingNames: Record<string, string> = existing.rows[0]?.page_names ?? {};
    const mergedIds = Array.from(new Set([...existingIds, ...newPageIds]));
    const mergedNames = { ...existingNames };
    for (const p of pages) mergedNames[p.id] = p.name;

    // Store blocked pages so frontend can surface them
    const blockedMap: Record<string, string> = {};
    for (const p of blockedPages) blockedMap[p.id] = p.name;

    await query(
      `INSERT INTO meta_integrations (tenant_id, access_token, token_expiry, page_ids, page_names, blocked_page_ids)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET access_token=$2, token_expiry=$3, page_ids=$4::jsonb, page_names=$5::jsonb, blocked_page_ids=$6::jsonb, updated_at=NOW()`,
      [tenantId, encrypted, expiry, JSON.stringify(mergedIds), JSON.stringify(mergedNames), JSON.stringify(blockedMap)]
    );

    let totalForms = 0;
    for (const page of pages) {
      const count = await syncPageForms(tenantId, page).catch((err: any) => {
        console.warn(`[META CONNECT] form sync failed for page ${page.id}:`, err.message);
        return 0;
      });
      totalForms += count;
    }
    // Reconnect pulls NOTHING: bump the poll floor to now so the self-heal window can't sweep a
    // pre-reconnect backlog (the cause of the flood). Missed leads come via the Import button.
    await query(`UPDATE meta_forms SET activated_at = NOW() WHERE tenant_id=$1 AND is_active=TRUE`, [tenantId]).catch(() => null);
    console.log('[META CONNECT] success — pages:', newPageIds, '| blocked:', blockedPages.map(p => p.name), '| forms synced:', totalForms);

    const blockedParam = blockedPages.length > 0 ? `&needs_token=${blockedPages.length}` : '';
    res.redirect(`${frontendUrl}/lead-generation/meta-forms?connected=true${blockedParam}`);
  } catch (err: any) {
    console.error('[META CONNECT ERROR]', err?.message ?? err);
    res.redirect(`${frontendUrl}/lead-generation/meta-forms?error=oauth_failed&reason=${encodeURIComponent(err?.message ?? 'unknown')}`);
  }
});

// All routes below require authentication
router.use(requireAuth);

// ── META ─────────────────────────────────────────────────────────────────────

// POST /api/integrations/meta/manual-connect — store a Page Access Token directly (no OAuth)
router.post('/meta/manual-connect', checkPermission('meta_forms:create'), async (req: AuthRequest, res: Response) => {
  const { access_token } = req.body as { access_token?: string };
  if (!access_token) { res.status(400).json({ error: 'access_token required' }); return; }

  try {
    // Validate token
    const meData = await graphGet('/me?fields=id,name', access_token);
    if (meData.error) {
      res.status(400).json({ error: 'Invalid token: ' + (meData.error.message ?? 'Unknown error') });
      return;
    }

    // Determine token type: User Access Token vs Page Access Token.
    // /me/accounts requires a User token. If it errors, the caller pasted a Page token,
    // in which case /me IS the page itself — use it directly.
    let pages: PageResult[] = [];
    let blockedPages: Array<{ id: string; name: string }> = [];
    const accountsProbe = await graphGet('/me/accounts?fields=id,name,access_token&limit=1', access_token);
    if (accountsProbe.error) {
      // Page Access Token — /me is the page
      pages = [{ id: meData.id, name: meData.name, access_token }];
      console.log('[META manual-connect] Page Access Token detected — page:', meData.name);
    } else {
      // User Access Token — fetch all pages including BM
      const result = await fetchAllPages(access_token);
      pages = result.connected;
      blockedPages = result.needsToken;
      console.log('[META manual-connect] connected:', pages.length, '| needs token:', blockedPages.length);
    }
    const pageIds = pages.map((p) => p.id);

    for (const page of pages) {
      await graphPost(`/${page.id}/subscribed_apps`, page.access_token, { subscribed_fields: 'leadgen' }).catch(() => null);
    }

    const tenantId = req.user!.tenantId;

    // Merge with any pages already stored from previous connections
    const existing = await query(
      'SELECT page_ids, page_names FROM meta_integrations WHERE tenant_id=$1',
      [tenantId]
    );
    const existingIds: string[] = existing.rows[0]?.page_ids ?? [];
    const existingNames: Record<string, string> = existing.rows[0]?.page_names ?? {};
    const mergedIds = Array.from(new Set([...existingIds, ...pageIds]));
    const mergedNames = { ...existingNames };
    for (const p of pages) mergedNames[p.id] = p.name;

    const blockedMap: Record<string, string> = {};
    for (const p of blockedPages) blockedMap[p.id] = p.name;
    const encrypted = encrypt(access_token);

    // Inspect token to get expiry date
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    let expiry: Date | null = null;
    if (appId && appSecret) {
      const debugData = await graphGet(
        `/debug_token?input_token=${access_token}&access_token=${appId}|${appSecret}`, ''
      ).catch(() => null);
      if (debugData?.data?.expires_at) {
        expiry = new Date(debugData.data.expires_at * 1000);
      }
    }

    await query(
      `INSERT INTO meta_integrations (tenant_id, access_token, token_expiry, page_ids, page_names, blocked_page_ids)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET access_token=$2, token_expiry=$3, page_ids=$4::jsonb, page_names=$5::jsonb, blocked_page_ids=$6::jsonb, updated_at=NOW()`,
      [tenantId, encrypted, expiry, JSON.stringify(mergedIds), JSON.stringify(mergedNames), JSON.stringify(blockedMap)]
    );

    const syncErrors: string[] = [];
    for (const page of pages) {
      await syncPageForms(tenantId!, page).catch((e: any) => {
        console.warn(`[manual-connect] form sync failed for page ${page.id}:`, e.message);
        syncErrors.push(page.name);
      });
    }
    // Reconnect pulls NOTHING: bump the poll floor to now so the self-heal window can't sweep a backlog.
    await query(`UPDATE meta_forms SET activated_at = NOW() WHERE tenant_id=$1 AND is_active=TRUE`, [tenantId]).catch(() => null);
    res.json({
      success: true,
      pages: mergedIds.map((id) => ({ id, name: mergedNames[id] ?? id })),
      needsToken: blockedPages,
      syncErrors,
    });
  } catch (err: any) {
    console.error('Meta manual connect error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/integrations/meta/status
// Serves purely from DB — no live Meta API calls to avoid rate limits.
// Live page data is refreshed only on OAuth connect or explicit Sync.
router.get('/meta/status', checkPermission('integrations:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT token_expiry, page_ids, page_names, blocked_page_ids, created_at, needs_reconnect, last_error, last_error_at, last_success_at FROM meta_integrations WHERE tenant_id=$1',
      [req.user!.tenantId]
    );
    if (!result.rows[0]) {
      res.json({ connected: false, connectedPages: [], blockedPages: [] });
      return;
    }
    const row = result.rows[0];
    const pageIds: string[] = row.page_ids ?? [];
    const nameMap: Record<string, string> = row.page_names ?? {};
    const blockedMap: Record<string, string> = row.blocked_page_ids ?? {};

    const expiry = row.token_expiry ? new Date(row.token_expiry) : null;
    const now = new Date();
    const tokenExpired = expiry ? expiry < now : false;
    const tokenDaysLeft = expiry ? Math.ceil((expiry.getTime() - now.getTime()) / 86400000) : null;

    res.json({
      connected: true,
      tokenExpiry: row.token_expiry,
      tokenExpired,
      tokenDaysLeft,
      connectedAt: row.created_at ?? null,
      needsReconnect: row.needs_reconnect === true,
      lastError: row.last_error ?? null,
      lastErrorAt: row.last_error_at ?? null,
      lastSuccessAt: row.last_success_at ?? null,
      connectedPages: pageIds.map((id) => ({ id, name: nameMap[id] ?? id })),
      blockedPages: Object.entries(blockedMap).map(([id, name]) => ({ id, name })),
    });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/integrations/meta/oauth-url
router.get('/meta/oauth-url', checkPermission('meta_forms:create'), (req: AuthRequest, res: Response) => {
  const appId = process.env.META_APP_ID;
  const baseUrl = process.env.WEBHOOK_BASE_URL ?? process.env.VITE_API_URL ?? 'http://localhost:3001';
  if (!appId) { res.status(503).json({ error: 'META_APP_ID not configured' }); return; }
  const redirectUri = encodeURIComponent(`${baseUrl}/api/integrations/meta/callback`);
  const scope = 'leads_retrieval,pages_manage_ads,pages_read_engagement,pages_show_list,ads_read,ads_management,business_management';
  // No auth_type here — fresh OAuth shows Facebook's page selector from scratch so the
  // user can tick ALL pages. auth_type=rerequest only re-requests declined permissions
  // and skips the page selector, which is why fewer pages get authorized.
  const apiVersion = process.env.META_API_VERSION ?? 'v21.0';
  const url = `https://www.facebook.com/${apiVersion}/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&state=${req.user!.tenantId}`;
  res.json({ url });
});

// GET /api/integrations/meta/add-page-url — same as oauth-url but called from "Add Page" flow
router.get('/meta/add-page-url', checkPermission('meta_forms:create'), (req: AuthRequest, res: Response) => {
  const appId = process.env.META_APP_ID;
  const baseUrl = process.env.WEBHOOK_BASE_URL ?? process.env.VITE_API_URL ?? 'http://localhost:3001';
  if (!appId) { res.status(503).json({ error: 'META_APP_ID not configured' }); return; }
  const redirectUri = encodeURIComponent(`${baseUrl}/api/integrations/meta/callback`);
  const scope = 'leads_retrieval,pages_manage_ads,pages_read_engagement,pages_show_list,ads_read,ads_management,business_management';
  const apiVersion = process.env.META_API_VERSION ?? 'v21.0';
  const url = `https://www.facebook.com/${apiVersion}/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&state=${req.user!.tenantId}`;
  res.json({ url });
});

// GET /api/integrations/meta/pages
router.get('/meta/pages', checkPermission('meta_forms:read'), async (req: AuthRequest, res: Response) => {
  try {
    const row = await query(
      'SELECT access_token FROM meta_integrations WHERE tenant_id=$1',
      [req.user!.tenantId]
    );
    if (!row.rows[0]) { res.status(404).json({ error: 'Meta not connected' }); return; }
    const token = decrypt(row.rows[0].access_token);
    const allPages = await graphGetAll('/me/accounts?fields=id,name,category,access_token', token);
    res.json(allPages.map((p: any) => ({
      id: p.id,
      name: p.name,
      category: p.category ?? '',
      access_token: p.access_token,
    })));
  } catch { res.status(500).json({ error: 'Failed to fetch pages' }); }
});

// POST /api/integrations/meta/pages/:pageId/subscribe
router.post('/meta/pages/:pageId/subscribe', checkPermission('meta_forms:create'), async (req: AuthRequest, res: Response) => {
  const { pageId } = req.params;
  const { pageAccessToken } = req.body as { pageAccessToken?: string };
  if (!pageAccessToken) { res.status(400).json({ error: 'pageAccessToken required' }); return; }
  try {
    await graphPost(`/${pageId}/subscribed_apps`, pageAccessToken, {
      subscribed_fields: 'leadgen',
    });
    // Store pageId in page_ids array
    await query(
      `UPDATE meta_integrations
       SET page_ids = (
         SELECT jsonb_agg(DISTINCT val)
         FROM jsonb_array_elements_text(page_ids || $2::jsonb) AS val
       ), updated_at=NOW()
       WHERE tenant_id=$1`,
      [req.user!.tenantId, JSON.stringify([pageId])]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to subscribe' }); }
});

// GET /api/integrations/meta/forms/:pageId
router.get('/meta/forms/:pageId', checkPermission('meta_forms:read'), async (req: AuthRequest, res: Response) => {
  const { pageId } = req.params;
  const { pageAccessToken } = req.query as { pageAccessToken?: string };
  if (!pageAccessToken) { res.status(400).json({ error: 'pageAccessToken required' }); return; }
  try {
    const forms = await graphGetAll(`/${pageId}/leadgen_forms?fields=id,name,status`, pageAccessToken);
    res.json(forms.map((f: any) => ({
      id: f.id,
      name: f.name,
      status: f.status ?? 'ACTIVE',
    })));
  } catch { res.status(500).json({ error: 'Failed to fetch forms' }); }
});

// POST /api/integrations/meta/forms/select
router.post('/meta/forms/select', checkPermission('meta_forms:create'), async (req: AuthRequest, res: Response) => {
  const { forms } = req.body as {
    forms: Array<{ page_id: string; form_id: string; form_name: string; page_name: string; pipeline_id?: string; stage_id?: string }>;
  };
  if (!Array.isArray(forms)) { res.status(400).json({ error: 'forms array required' }); return; }
  const tenantId = req.user!.tenantId;
  try {
    for (const f of forms) {
      await query(
        `INSERT INTO meta_forms (tenant_id, page_id, page_name, form_id, form_name, pipeline_id, stage_id, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE)
         ON CONFLICT (tenant_id, form_id) DO UPDATE
           SET form_name=$5, page_name=$3, pipeline_id=$6, stage_id=$7`,
        [tenantId, f.page_id, f.page_name ?? '', f.form_id, f.form_name ?? '', f.pipeline_id ?? null, f.stage_id ?? null]
      );
    }
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/integrations/meta/forms/:formId/questions — fetch FB form question list
router.get('/meta/forms/:formId/questions', checkPermission('meta_forms:read'), async (req: AuthRequest, res: Response) => {
  const { formId } = req.params;
  const tenantId = req.user!.tenantId;
  try {
    // Try fast path: serve from DB cache (handles missing questions column gracefully)
    let pageId: string | null = null;

    try {
      const mfRes = await query(
        'SELECT page_id, questions FROM meta_forms WHERE tenant_id=$1 AND form_id=$2 LIMIT 1',
        [tenantId, formId]
      );
      if (!mfRes.rows[0]) { res.json({ questions: [], form_name: '' }); return; }
      pageId = mfRes.rows[0].page_id;
      const cached = mfRes.rows[0].questions;
      if (Array.isArray(cached) && cached.length > 0) {
        res.json({ questions: cached, form_name: '' });
        return;
      }
    } catch (colErr: any) {
      if (colErr.code === '42703') {
        // questions column not yet created — fall through to fetch from Meta
        const mfFallback = await query(
          'SELECT page_id FROM meta_forms WHERE tenant_id=$1 AND form_id=$2 LIMIT 1',
          [tenantId, formId]
        ).catch(() => ({ rows: [] }));
        if (!mfFallback.rows[0]) { res.json({ questions: [], form_name: '' }); return; }
        pageId = mfFallback.rows[0].page_id;
      } else {
        throw colErr;
      }
    }

    // Cache miss — fetch from Meta API and store for next time
    const miRes = await query('SELECT access_token FROM meta_integrations WHERE tenant_id=$1', [tenantId]);
    if (!miRes.rows[0]) { res.json({ questions: [], form_name: '' }); return; }

    const userToken = decrypt(miRes.rows[0].access_token);
    let pageToken = userToken;
    try {
      const allPages = await graphGetAll('/me/accounts?fields=id,name,access_token', userToken);
      const page = allPages.find((p: any) => p.id === pageId);
      if (page?.access_token) pageToken = page.access_token;
    } catch { /* use user token */ }

    try {
      const formData = await graphGet(`/${formId}?fields=questions,name`, pageToken);
      if (formData.error) {
        console.warn('[form-questions]', formData.error.message);
        res.json({ questions: [], form_name: '' });
        return;
      }
      const questions = extractQuestions(formData.questions);
      // Store in cache for future requests (ignore if column missing)
      await query(
        'UPDATE meta_forms SET questions=$1::jsonb WHERE tenant_id=$2 AND form_id=$3',
        [JSON.stringify(questions), tenantId, formId]
      ).catch(() => null);
      res.json({ questions, form_name: formData.name ?? '' });
    } catch (metaErr: any) {
      console.warn('[form-questions] Meta API error:', metaErr.message);
      res.json({ questions: [], form_name: '' });
    }
  } catch (err: any) {
    console.error('[form-questions]', err.message);
    res.json({ questions: [], form_name: '' });
  }
});

// GET /api/integrations/meta/forms/:formId/mapping
router.get('/meta/forms/:formId/mapping', checkPermission('meta_forms:read'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT field_mapping FROM meta_forms WHERE tenant_id=$1 AND form_id=$2 LIMIT 1',
      [req.user!.tenantId, req.params.formId]
    );
    const mapping = result.rows[0]?.field_mapping;
    res.json(Array.isArray(mapping) ? mapping : []);
  } catch (err: any) {
    // 42703 = column doesn't exist yet (migration pending) — return empty gracefully
    if (err.code === '42703') { res.json([]); return; }
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/integrations/meta/forms/:formId/mapping
router.post('/meta/forms/:formId/mapping', checkPermission('meta_forms:edit'), async (req: AuthRequest, res: Response) => {
  const { mapping } = req.body as { mapping: Array<{ fb_field: string; crm_field: string }> };
  if (!Array.isArray(mapping)) { res.status(400).json({ error: 'mapping array required' }); return; }
  const tenantId = req.user!.tenantId;
  const formId   = req.params.formId;

  try {
    await query(
      'UPDATE meta_forms SET field_mapping=$1 WHERE tenant_id=$2 AND form_id=$3',
      [JSON.stringify(mapping), tenantId, formId]
    );
  } catch (err: any) {
    if (err.code === '42703') {
      await query('ALTER TABLE meta_forms ADD COLUMN IF NOT EXISTS field_mapping JSONB').catch(() => null);
      await query(
        'UPDATE meta_forms SET field_mapping=$1 WHERE tenant_id=$2 AND form_id=$3',
        [JSON.stringify(mapping), tenantId, formId]
      ).catch(() => null);
    } else {
      res.status(500).json({ error: 'Server error' }); return;
    }
  }

  res.json({ success: true });

  // Retroactively apply the new mapping to leads already imported from this form.
  // Runs in background — does not block the response.
  const safeTenantId = tenantId as string;
  setImmediate(async () => {
    try {
      const miRes = await query(
        'SELECT access_token FROM meta_integrations WHERE tenant_id=$1',
        [safeTenantId]
      );
      if (!miRes.rows[0]) return;
      const token = decrypt(miRes.rows[0].access_token);

      const allLeads = await graphGetAll(
        `/${formId}/leads?fields=id,created_time,field_data`,
        token
      ).catch(() => [] as any[]);

      for (const leadEntry of allLeads) {
        const leadgenId: string = leadEntry.id;
        if (!leadgenId) continue;

        const existing = await query(
          `SELECT id FROM leads WHERE tenant_id=$1 AND source='meta_form' AND source_ref=$2 AND is_deleted=FALSE LIMIT 1`,
          [safeTenantId, leadgenId]
        );
        if (!existing.rows[0]) continue;

        const leadId = existing.rows[0].id as string;

        // Backfill meta_form_id for pre-migration_020 leads
        await query(
          `UPDATE leads SET meta_form_id=$1 WHERE id=$2 AND meta_form_id IS NULL`,
          [formId, leadId]
        ).catch(() => null);

        const { customValues } = parseMetaFieldData(leadEntry.field_data ?? [], mapping);
        if (Object.keys(customValues).length > 0) {
          await storeCustomValues(leadId, safeTenantId, customValues);
        }
      }
      console.log(`[mapping] retroactive custom-field update done for form ${formId}`);
    } catch (e: any) {
      console.error(`[mapping] retroactive update failed for form ${formId}:`, e.message);
    }
  });
});

// POST /api/integrations/meta/forms/:formId/backfill
// Fixes meta_form_id + re-applies custom field values for ALL existing leads from this form.
// Handles leads with null source_ref via email/phone fallback.
router.post('/meta/forms/:formId/backfill', checkPermission('meta_forms:edit'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId as string;
  const { formId } = req.params;

  try {
    const miRes = await query('SELECT access_token FROM meta_integrations WHERE tenant_id=$1', [tenantId]);
    if (!miRes.rows[0]) { res.status(400).json({ error: 'Meta not connected' }); return; }

    let token: string;
    try { token = decrypt(miRes.rows[0].access_token); }
    catch { res.status(500).json({ error: 'Token decrypt failed' }); return; }

    const mfRes = await query(
      'SELECT id, form_id, field_mapping FROM meta_forms WHERE tenant_id=$1 AND form_id=$2',
      [tenantId, formId]
    );
    if (!mfRes.rows[0]) { res.status(404).json({ error: 'Form not found' }); return; }
    const mf = mfRes.rows[0];
    const mapping: Array<{ fb_field: string; crm_field: string }> = mf.field_mapping ?? [];

    const allMetaLeads = await graphGetAll(
      `/${formId}/leads?fields=id,field_data`, token
    ).catch(() => [] as any[]);

    let matched = 0;
    let fieldsApplied = 0;

    for (const leadEntry of allMetaLeads) {
      const leadgenId = String(leadEntry.id ?? '');
      if (!leadgenId) continue;

      const { name, email, phone, customValues } = parseMetaFieldData(leadEntry.field_data ?? [], mapping);

      // 1. Find by source_ref (primary)
      let existing = await query(
        `SELECT id FROM leads WHERE tenant_id=$1 AND source='meta_form' AND source_ref=$2 AND is_deleted=FALSE LIMIT 1`,
        [tenantId, leadgenId]
      );

      // 2. Fallback: match by email/phone for leads imported before source_ref was tracked
      if (!existing.rows[0] && (email || phone)) {
        existing = await query(
          `SELECT id FROM leads WHERE tenant_id=$1 AND source='meta_form' AND is_deleted=FALSE
           AND (($2::text<>'' AND LOWER(email)=LOWER($2)) OR ($3::text<>'' AND phone=$3))
           AND (source_ref IS NULL OR source_ref='') LIMIT 1`,
          [tenantId, email, phone]
        );
        if (existing.rows[0]) {
          // Backfill source_ref now that we know it
          await query(`UPDATE leads SET source_ref=$1 WHERE id=$2`, [leadgenId, existing.rows[0].id]).catch(() => null);
        }
      }

      if (!existing.rows[0]) continue;
      matched++;

      const leadId = existing.rows[0].id as string;

      // Always backfill meta_form_id if missing
      await query(`UPDATE leads SET meta_form_id=$1 WHERE id=$2 AND meta_form_id IS NULL`, [formId, leadId]).catch(() => null);

      // Re-apply field mapping
      if (Object.keys(customValues).length > 0) {
        await storeCustomValues(leadId, tenantId, customValues);
        fieldsApplied++;
      }
    }

    res.json({ matched, fieldsApplied, total: allMetaLeads.length });
  } catch (err: any) {
    console.error('[backfill]', err);
    res.status(500).json({ error: err.message ?? 'Server error' });
  }
});

// GET /api/integrations/meta/sync-forms
// Default (page load): serves from DB instantly — no Meta API calls, no rate limit risk.
// With ?force=1 (Sync Forms button): calls Meta live to pick up new forms.
router.get('/meta/sync-forms', checkPermission('meta_forms:read'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId as string;
  const force = req.query.force === '1';
  try {
    let synced = 0;
    let failed = 0;
    const syncErrors: string[] = [];

    if (force) {
      const miRes = await query(
        'SELECT access_token FROM meta_integrations WHERE tenant_id=$1',
        [tenantId]
      );
      if (miRes.rows[0]) {
        const token = decrypt(miRes.rows[0].access_token);
        try {
          const { connected: pages } = await fetchAllPages(token);
          for (const page of pages) {
            try {
              const count = await syncPageForms(tenantId, page);
              synced += count;
            } catch (pageErr: any) {
              console.warn(`[sync-forms] skipped page ${page.id}:`, pageErr.message);
              failed++;
              syncErrors.push(`${page.name}: ${pageErr.message}`);
            }
          }
        } catch (metaErr: any) {
          console.warn('[sync-forms] Meta API error:', metaErr.message);
          syncErrors.push('Meta API: ' + metaErr.message);
          failed++;
        }
      } else {
        syncErrors.push('Meta not connected');
        failed++;
      }
    }

    const result = await query(
      `SELECT mf.*,
              p.name AS pipeline_name, ps.name AS stage_name,
              COALESCE(mf.leads_count, 0)::int AS leads_count
       FROM meta_forms mf
       LEFT JOIN pipelines p ON p.id = mf.pipeline_id
       LEFT JOIN pipeline_stages ps ON ps.id = mf.stage_id
       WHERE mf.tenant_id=$1 ORDER BY mf.created_at DESC`,
      [tenantId]
    );

    if (force) {
      res.json({ forms: result.rows, synced, failed, errors: syncErrors });
    } else {
      res.json(result.rows);
    }
  } catch (err: any) {
    console.error('[sync-forms]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/integrations/meta/fetch-all-leads — pull every historical lead from Meta into CRM
router.post('/meta/fetch-all-leads', checkPermission('meta_forms:read'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const miRes = await query(
      'SELECT access_token FROM meta_integrations WHERE tenant_id=$1',
      [tenantId]
    );
    if (!miRes.rows[0]) { res.status(400).json({ error: 'Not connected' }); return; }
    const token = decrypt(miRes.rows[0].access_token);

    const totalInserted = await fetchAndInsertAllLeads(tenantId!, token);
    res.json({ totalInserted });
  } catch (err) {
    console.error('[fetch-all-leads]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/integrations/meta/export-leads — fetch raw Meta leads and return as JSON for Excel download
router.post('/meta/export-leads', checkPermission('meta_forms:read'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { form_ids } = req.body as { form_ids?: string[] };

  try {
    const miRes = await query('SELECT access_token FROM meta_integrations WHERE tenant_id=$1', [tenantId]);
    if (!miRes.rows[0]) { res.status(400).json({ error: 'Meta not connected' }); return; }
    let token: string;
    try { token = decrypt(miRes.rows[0].access_token); }
    catch { res.status(500).json({ error: 'Failed to decrypt Meta token' }); return; }

    let formsRes;
    if (Array.isArray(form_ids) && form_ids.length > 0) {
      formsRes = await query(
        `SELECT id, form_id, form_name, page_id FROM meta_forms WHERE tenant_id=$1 AND id = ANY($2::uuid[])`,
        [tenantId, form_ids]
      );
    } else {
      formsRes = await query(
        `SELECT id, form_id, form_name, page_id FROM meta_forms WHERE tenant_id=$1 ORDER BY created_at DESC`,
        [tenantId]
      );
    }

    const pageTokenMap = await buildPageTokenMap(token);

    const rows: Record<string, string>[] = [];
    for (const mf of formsRes.rows) {
      const leadToken = pageTokenMap.get(mf.page_id) ?? token;
      const leads = await graphGetAll(
        `/${mf.form_id}/leads?fields=id,created_time,field_data`, leadToken
      ).catch(() => [] as any[]);

      for (const lead of leads) {
        const row: Record<string, string> = {
          'Form Name': mf.form_name ?? '',
          'Lead ID': String(lead.id ?? ''),
          'Submitted At': String(lead.created_time ?? ''),
        };
        for (const fd of (lead.field_data ?? [])) {
          const col = String(fd.name ?? '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c: string) => c.toUpperCase());
          row[col] = (fd.values ?? []).join(', ');
        }
        rows.push(row);
      }
    }

    res.json({ rows });
  } catch (err: any) {
    console.error('[export-leads]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/integrations/meta/forms/:formId/import?type=old|new
router.post('/meta/forms/:formId/import', checkPermission('meta_forms:create'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId as string;
  const { formId } = req.params;
  const type = (req.query.type as string) === 'new' ? 'new' : 'old';
  const { pipeline_id: bodyPipelineId, stage_id: bodyStageId } = req.body ?? {};

  try {
    const miRes = await query(
      'SELECT access_token FROM meta_integrations WHERE tenant_id=$1',
      [tenantId]
    );
    if (!miRes.rows[0]) { res.status(400).json({ error: 'Meta not connected' }); return; }

    let token: string;
    try { token = decrypt(miRes.rows[0].access_token); }
    catch { res.status(500).json({ error: 'Failed to decrypt Meta token' }); return; }

    const mfRes = await query(
      'SELECT id, form_id, form_name, field_mapping, pipeline_id, stage_id, last_sync_at, page_id FROM meta_forms WHERE tenant_id=$1 AND form_id=$2',
      [tenantId, formId]
    );
    if (!mfRes.rows[0]) { res.status(404).json({ error: 'Form not found' }); return; }
    const mf = mfRes.rows[0];
    const mapping: Array<{ fb_field: string; crm_field: string }> = mf.field_mapping ?? [];

    // Use pipeline/stage from body (user selected in modal), fall back to stored values
    const effectivePipelineId = bodyPipelineId || mf.pipeline_id || null;
    const effectiveStageId    = bodyStageId    || mf.stage_id    || null;
    if (!effectivePipelineId || !effectiveStageId) {
      res.status(400).json({ error: 'Select a pipeline and stage before importing' }); return;
    }
    // Persist selection back to the form record so future imports remember it
    if (bodyPipelineId || bodyStageId) {
      await query(
        'UPDATE meta_forms SET pipeline_id=$1, stage_id=$2 WHERE id=$3',
        [effectivePipelineId, effectiveStageId, mf.id]
      ).catch((e: any) => console.error('[form-import] pipeline persist failed:', e.message));
    }

    const pageTokenMap = await buildPageTokenMap(token);
    const leadToken = pageTokenMap.get(mf.page_id) ?? token;

    let metaUrl = `/${formId}/leads?fields=id,created_time,field_data`;
    if (type === 'new' && mf.last_sync_at) {
      const since = Math.floor(new Date(mf.last_sync_at).getTime() / 1000) - 60;
      metaUrl += `&since=${since}`;
    }

    let allLeads: any[] = [];
    try {
      allLeads = await graphGetAll(metaUrl, leadToken);
    } catch (metaErr: any) {
      console.error('[form-import] Meta API error:', metaErr.message);
      res.status(502).json({ error: `Meta API error: ${metaErr.message}` });
      return;
    }

    let inserted = 0;
    let skipped  = 0;

    for (const leadEntry of allLeads) {
      try {
        const leadgenId: string = String(leadEntry.id ?? '');
        if (!leadgenId) { skipped++; continue; }

        const { name, email, phone, customValues } = parseMetaFieldData(
          leadEntry.field_data ?? [],
          mapping
        );

        // Check already imported (including soft-deleted — holds the unique slot)
        const anyExisting = await query(
          `SELECT id, is_deleted FROM leads WHERE tenant_id=$1 AND source='meta_form' AND source_ref=$2 LIMIT 1`,
          [tenantId, leadgenId]
        );

        if (anyExisting.rows[0]) {
          const existingId = anyExisting.rows[0].id as string;
          if (anyExisting.rows[0].is_deleted) {
            // Restore a previously soft-deleted lead — user explicitly re-importing
            await query(
              `UPDATE leads SET is_deleted=FALSE, pipeline_id=$1, stage_id=$2, meta_form_id=$3, updated_at=NOW() WHERE id=$4`,
              [effectivePipelineId, effectiveStageId, mf.form_id, existingId]
            );
            if (Object.keys(customValues).length > 0) {
              await storeCustomValues(existingId, tenantId, customValues);
            }
            inserted++;
          } else {
            // Active lead already in CRM — just backfill meta_form_id if missing, count as skipped
            await query(
              `UPDATE leads SET meta_form_id=$1 WHERE id=$2 AND meta_form_id IS NULL`,
              [mf.form_id, existingId]
            ).catch(() => null);
            skipped++;
          }
          continue;
        }

        // Dedup by email/phone — scoped to the target pipeline (multi-pipeline support).
        const dup = (email || phone) ? await query(
          `SELECT id FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE
           AND (($2::text<>'' AND LOWER(email)=$2) OR ($3::text<>'' AND phone=$3))
           AND ($4::uuid IS NULL OR pipeline_id = $4::uuid) LIMIT 1`,
          [tenantId, email, phone, effectivePipelineId]
        ) : { rows: [] };
        if (dup.rows[0]) { skipped++; continue; }

        const createdAt = parseMetaTimestamp(leadEntry.created_time);

        const newLead = await query(
          `INSERT INTO leads (tenant_id, name, email, phone, source, source_ref, meta_form_id, pipeline_id, stage_id, created_at, meta_created_at)
           VALUES ($1,$2,$3,$4,'meta_form',$5,$6,$7,$8,$9,$9)
           ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL AND source_ref <> ''
           DO NOTHING
           RETURNING *`,
          [tenantId, name, email, phone, leadgenId, mf.form_id, effectivePipelineId, effectiveStageId, createdAt]
        );
        const newLeadRow = newLead.rows[0];
        if (!newLeadRow) { skipped++; continue; }

        inserted++;
        if (Object.keys(customValues).length > 0) {
          await storeCustomValues(newLeadRow.id as string, tenantId, customValues);
        }
        // Historical import is SILENT: insert only — no automation replay and no new-lead
        // notification. Avoids assign/route/webhook/notification blasts on a bulk backlog.
      } catch (leadErr: any) {
        console.error('[form-import] lead error:', leadErr.message);
        skipped++;
      }
    }

    await query(
      `UPDATE meta_forms SET leads_count=(SELECT COUNT(*) FROM leads WHERE meta_form_id=$1 AND tenant_id=$2 AND is_deleted=FALSE), last_sync_at=NOW() WHERE id=$3`,
      [mf.form_id, tenantId, mf.id]
    ).catch((e: any) => console.error('[form-import] leads_count update failed:', e.message));

    res.json({ inserted, skipped, total: allLeads.length });
  } catch (err: any) {
    console.error('[form-import]', err);
    res.status(500).json({ error: err.message ?? 'Server error' });
  }
});

// GET /api/integrations/meta/forms/:formId/download-leads
// Returns all raw leads from Meta for a form (no CRM mapping) — used for Excel download
router.get('/meta/forms/:formId/download-leads', checkPermission('meta_forms:read'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId as string;
  const { formId } = req.params;
  try {
    const miRes = await query('SELECT access_token FROM meta_integrations WHERE tenant_id=$1', [tenantId]);
    if (!miRes.rows[0]) { res.status(400).json({ error: 'Meta not connected' }); return; }
    let token: string;
    try { token = decrypt(miRes.rows[0].access_token); }
    catch { res.status(500).json({ error: 'Failed to decrypt Meta token' }); return; }

    const mfRes = await query(
      'SELECT form_name, page_id FROM meta_forms WHERE tenant_id=$1 AND form_id=$2',
      [tenantId, formId]
    );
    if (!mfRes.rows[0]) { res.status(404).json({ error: 'Form not found' }); return; }
    const { form_name, page_id } = mfRes.rows[0];

    const pageTokenMap = await buildPageTokenMap(token);
    const leadToken = pageTokenMap.get(page_id) ?? token;

    const metaLeads = await graphGetAll(`/${formId}/leads?fields=id,created_time,field_data`, leadToken);
    res.json({ form_name, leads: metaLeads });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Server error' });
  }
});

// GET /api/integrations/meta/forms/:formId/workflows
// Returns active workflows whose trigger matches this meta form — used by the "Trigger Workflow" picker
router.get('/meta/forms/:formId/workflows', checkPermission('meta_forms:edit'), async (req: AuthRequest, res: Response) => {
  const { tenantId } = req.user!;
  const { formId } = req.params;
  try {
    const mfRes = await query('SELECT form_name FROM meta_forms WHERE tenant_id=$1 AND form_id=$2', [tenantId, formId]);
    const formName = mfRes.rows[0]?.form_name ?? '';
    const wfRes = await query(`SELECT id, name, nodes FROM workflows WHERE tenant_id=$1 AND status='active'`, [tenantId]);
    const matching: Array<{ id: string; name: string }> = [];
    for (const wf of wfRes.rows) {
      const nodes: any[] = Array.isArray(wf.nodes) ? wf.nodes : JSON.parse(wf.nodes ?? '[]');
      const trigger = nodes.find((n: any) => n.type === 'trigger');
      if (!trigger) continue;
      if (!['meta_form', 'form_submitted', 'lead_created'].includes(trigger.actionType ?? '')) continue;
      const cfgForms = trigger.config?.forms as string[] | undefined;
      // Empty form list = inactive by design (bug-fix #7) — exclude from picker
      if (!cfgForms || cfgForms.length === 0) continue;
      if (!cfgForms.includes(formId) && !cfgForms.includes(formName)) continue;
      matching.push({ id: wf.id, name: wf.name });
    }
    res.json(matching);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/integrations/meta/forms/:formId/push-automation?type=old|new
// Fetches leads from Meta, upserts them (no pipeline/stage needed — automation handles that),
// fires meta_form trigger for every lead so matching live automations execute.
// Body: { workflow_id?: string } — if provided, only that workflow runs (not all matching ones)
router.post('/meta/forms/:formId/push-automation', checkPermission('meta_forms:edit'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId as string;
  const userId   = req.user!.userId   as string;
  const { formId } = req.params;
  const type = (req.query.type as string) === 'new' ? 'new' : 'old';
  const selectedWorkflowId: string | undefined = req.body?.workflow_id ?? undefined;

  try {
    const miRes = await query('SELECT access_token FROM meta_integrations WHERE tenant_id=$1', [tenantId]);
    if (!miRes.rows[0]) { res.status(400).json({ error: 'Meta not connected' }); return; }
    let token: string;
    try { token = decrypt(miRes.rows[0].access_token); }
    catch { res.status(500).json({ error: 'Failed to decrypt Meta token' }); return; }

    const mfRes = await query(
      'SELECT id, form_id, form_name, field_mapping, last_sync_at, pipeline_id, stage_id, page_id, meta_status FROM meta_forms WHERE tenant_id=$1 AND form_id=$2',
      [tenantId, formId]
    );
    if (!mfRes.rows[0]) { res.status(404).json({ error: 'Form not found' }); return; }
    const mf = mfRes.rows[0];
    const mapping: Array<{ fb_field: string; crm_field: string }> = mf.field_mapping ?? [];

    // Collect matching workflows — must have meta_form/form_submitted/lead_created trigger
    // AND must have this form's id or name in their form list (empty list = never fires).
    const wfRes = await query(
      `SELECT id, name, nodes FROM workflows WHERE tenant_id=$1 AND status='active'`,
      [tenantId]
    );
    const matchingWFs: Array<{ id: string; name: string }> = [];
    for (const wf of wfRes.rows) {
      const nodes: any[] = Array.isArray(wf.nodes) ? wf.nodes : JSON.parse(wf.nodes ?? '[]');
      const trigger = nodes.find((n: any) => n.type === 'trigger');
      if (!trigger) continue;
      if (!['meta_form', 'form_submitted', 'lead_created'].includes(trigger.actionType ?? '')) continue;
      const cfgForms = trigger.config?.forms as string[] | undefined;
      // For form triggers: empty form list = inactive by design (bug-fix #7) — skip
      if (!cfgForms || cfgForms.length === 0) continue;
      if (!cfgForms.includes(formId) && !cfgForms.includes(mf.form_name)) continue;
      matchingWFs.push({ id: wf.id, name: wf.name });
    }

    // Validate selectedWorkflowId up-front so we can return a clear error immediately
    // instead of silently producing Done:0 when the workflow was deactivated between
    // modal-open and the user clicking "Run Workflow".
    if (selectedWorkflowId && !matchingWFs.find((w) => w.id === selectedWorkflowId)) {
      res.status(400).json({ error: 'The selected workflow is no longer active or does not match this form. Reopen the picker to choose a current workflow.' });
      return;
    }
    // Use page access token for lead retrieval — Meta requires it for /{formId}/leads
    const pageTokenMap = await buildPageTokenMap(token);
    const leadToken = pageTokenMap.get(mf.page_id) ?? token;
    console.log(`[push-automation] form ${formId} meta_status=${mf.meta_status ?? 'unknown'} page_id=${mf.page_id} using ${pageTokenMap.has(mf.page_id) ? 'page token' : 'user token (no page token found)'}`);

    // Fetch leads from Meta — always proceed even if no workflows match yet
    let metaUrl = `/${formId}/leads?fields=id,created_time,field_data`;
    if (type === 'new' && mf.last_sync_at) {
      const since = Math.floor(new Date(mf.last_sync_at).getTime() / 1000) - 60;
      metaUrl += `&since=${since}`;
    }
    let allMetaLeads: any[] = [];
    try { allMetaLeads = await graphGetAll(metaUrl, leadToken); }
    catch (metaErr: any) { res.status(502).json({ error: `Meta API error: ${metaErr.message}` }); return; }
    console.log(`[push-automation] Meta returned ${allMetaLeads.length} leads for form ${formId}`);

    let created = 0;
    let existing = 0;
    const crmLeads: any[] = [];

    for (const leadEntry of allMetaLeads) {
      try {
        const leadgenId = String(leadEntry.id ?? '');
        if (!leadgenId) continue;
        const { name, email, phone, customValues } = parseMetaFieldData(leadEntry.field_data ?? [], mapping);
        const createdAt = parseMetaTimestamp(leadEntry.created_time);

        // Check by source_ref — including soft-deleted rows (so we can restore them)
        const existingRes = await query(
          `SELECT * FROM leads WHERE tenant_id=$1 AND source='meta_form' AND source_ref=$2 LIMIT 1`,
          [tenantId, leadgenId]
        );
        let leadRow: any = existingRes.rows[0];

        if (leadRow && !leadRow.is_deleted) {
          // Already active in CRM — update meta_form_id if not yet set
          if (!leadRow.meta_form_id) {
            await query(
              `UPDATE leads SET meta_form_id=$1, updated_at=NOW() WHERE id=$2 AND meta_form_id IS NULL`,
              [mf.form_id, leadRow.id]
            ).catch(() => null);
            leadRow = { ...leadRow, meta_form_id: mf.form_id };
          }
          existing++;
        } else if (leadRow && leadRow.is_deleted) {
          // Was deleted — restore it
          const restored = await query(
            `UPDATE leads SET is_deleted=FALSE, updated_at=NOW(),
               meta_form_id=COALESCE(meta_form_id,$1), source_ref=COALESCE(source_ref,$2)
             WHERE id=$3 RETURNING *`,
            [mf.form_id, leadgenId, leadRow.id]
          );
          leadRow = restored.rows[0] ?? leadRow;
          created++;
        } else {
          // Check by email/phone among active leads
          const dup = (email || phone) ? await query(
            `SELECT * FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE
             AND (($2::text<>'' AND LOWER(email)=LOWER($2)) OR ($3::text<>'' AND phone=$3)) LIMIT 1`,
            [tenantId, email, phone]
          ) : { rows: [] };

          if (dup.rows[0]) {
            leadRow = dup.rows[0];
            await query(
              `UPDATE leads SET meta_form_id=COALESCE(meta_form_id,$1), source_ref=COALESCE(source_ref,$2),
               pipeline_id=$3, stage_id=$4, updated_at=NOW() WHERE id=$5`,
              [mf.form_id, leadgenId, mf.pipeline_id ?? null, mf.stage_id ?? null, leadRow.id]
            ).catch(() => null);
            existing++;
          } else {
            // Fresh insert — use upsert to handle any remaining unique conflicts
            const ins = await query(
              `INSERT INTO leads (tenant_id, name, email, phone, source, source_ref, meta_form_id, created_at, pipeline_id, stage_id)
               VALUES ($1,$2,$3,$4,'meta_form',$5,$6,$7,$8,$9)
               ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL AND source_ref <> ''
               DO UPDATE SET is_deleted=FALSE, meta_form_id=EXCLUDED.meta_form_id, pipeline_id=$8, stage_id=$9, updated_at=NOW() RETURNING *`,
              [tenantId, name, email, phone, leadgenId, mf.form_id, createdAt, mf.pipeline_id ?? null, mf.stage_id ?? null]
            );
            if (!ins.rows[0]) continue;
            leadRow = ins.rows[0];
            if (Object.keys(customValues).length > 0) await storeCustomValues(leadRow.id, tenantId, customValues);
            sendNewLeadNotification(tenantId, leadRow, null).catch(() => null);
            created++;
          }
        }
        await upsertContact(tenantId, leadRow);
        crmLeads.push({ ...leadRow, form_id: mf.form_id, form_name: mf.form_name });
      } catch (e: any) { console.error('[push-automation] lead error:', e.message); }
    }

    // Execute workflows via the battle-tested triggerWorkflows path.
    // This replaces the old executeNodes-direct path that silently failed for all leads
    // due to a re-query that returned null. triggerWorkflows handles enrichment, form
    // matching against trigger_forms DB column, re-entry, node execution, and logging.
    const wfsToRun = selectedWorkflowId
      ? matchingWFs.filter((w: any) => w.id === selectedWorkflowId)
      : matchingWFs;

    const pushStartedAt = new Date();

    for (const lead of crmLeads) {
      try {
        await triggerWorkflows(
          'meta_form',
          lead,
          tenantId,
          userId,
          { forceReEntry: true, workflowId: selectedWorkflowId ?? undefined }
        );
      } catch (e: any) {
        console.error('[push-automation] triggerWorkflows error for lead', lead.id, ':', e.message);
      }
    }

    // Read back execution stats from workflow_executions rows enrolled in this push
    const execStatRows = await query(
      `SELECT status, COUNT(*)::int AS count
       FROM workflow_executions
       WHERE tenant_id   = $1
         AND lead_id     = ANY($2::uuid[])
         AND enrolled_at >= $3
         AND ($4::uuid IS NULL OR workflow_id = $4::uuid)
       GROUP BY status`,
      [tenantId, crmLeads.map((l: any) => l.id), pushStartedAt, selectedWorkflowId ?? null]
    ).catch(() => ({ rows: [] as any[] }));

    const statMap: Record<string, number> = {};
    for (const row of execStatRows.rows) statMap[row.status] = Number(row.count);
    const totalDone    = statMap['completed'] ?? 0;
    const totalSkipped = (statMap['skipped'] ?? 0) + (statMap['superseded'] ?? 0);
    const totalFailed  = statMap['failed']    ?? 0;

    await query(
      `UPDATE meta_forms SET leads_count=(SELECT COUNT(*) FROM leads WHERE meta_form_id=$1 AND tenant_id=$2 AND is_deleted=FALSE), last_sync_at=NOW() WHERE id=$3`,
      [mf.form_id, tenantId, mf.id]
    ).catch(() => null);

    res.json({ pushed: crmLeads.length, created, existing, workflows: wfsToRun, done: totalDone, skipped: totalSkipped, failed: totalFailed });
  } catch (err: any) {
    console.error('[push-automation]', err);
    res.status(500).json({ error: err.message ?? 'Server error' });
  }
});

// GET /api/integrations/meta/connected-forms — list saved meta forms for tenant
router.get('/meta/connected-forms', checkPermission('meta_forms:read'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT mf.*,
              p.name AS pipeline_name, ps.name AS stage_name,
              COALESCE(mf.leads_count, 0)::int AS leads_count
       FROM meta_forms mf
       LEFT JOIN pipelines p ON p.id = mf.pipeline_id
       LEFT JOIN pipeline_stages ps ON ps.id = mf.stage_id
       WHERE mf.tenant_id=$1 ORDER BY mf.created_at DESC`,
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/integrations/meta/connected-forms/:id — update active, pipeline, stage
router.patch('/meta/connected-forms/:id', checkPermission('meta_forms:edit'), async (req: AuthRequest, res: Response) => {
  const { is_active, pipeline_id, stage_id } = req.body;
  const setClauses: string[] = [];
  const params: any[] = [];
  if (is_active  !== undefined) { params.push(is_active);   setClauses.push(`is_active=$${params.length}`); }
  if (pipeline_id !== undefined) { params.push(pipeline_id); setClauses.push(`pipeline_id=$${params.length}`); }
  if (stage_id    !== undefined) { params.push(stage_id);    setClauses.push(`stage_id=$${params.length}`); }
  if (!setClauses.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  // Reset cursor to NOW() on every activation so the cron only fetches leads
  // submitted after this activation, not historical ones from a previous activation.
  if (is_active === true) {
    setClauses.push(`activated_at = NOW()`);
  }
  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE meta_forms SET ${setClauses.join(',')} WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/integrations/meta/connected-forms/:id
router.delete('/meta/connected-forms/:id', checkPermission('meta_forms:delete'), async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM meta_forms WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user!.tenantId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/integrations/meta/pages/:pageId — disconnect a single page
router.delete('/meta/pages/:pageId', checkPermission('meta_forms:delete'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { pageId } = req.params;
  try {
    const row = (await query('SELECT page_ids, page_names FROM meta_integrations WHERE tenant_id=$1', [tenantId])).rows[0];
    if (!row) { res.status(404).json({ error: 'Not connected' }); return; }

    const pageIds: string[] = (row.page_ids ?? []).filter((id: string) => id !== pageId);
    const pageNames: Record<string, string> = { ...(row.page_names ?? {}) };
    delete pageNames[pageId];

    // Remove forms for this page
    await query('DELETE FROM meta_forms WHERE tenant_id=$1 AND page_id=$2', [tenantId, pageId]);

    if (pageIds.length === 0) {
      // Last page removed — full disconnect
      await query('DELETE FROM meta_integrations WHERE tenant_id=$1', [tenantId]);
      res.json({ success: true, fullyDisconnected: true });
    } else {
      await query(
        'UPDATE meta_integrations SET page_ids=$1::jsonb, page_names=$2::jsonb WHERE tenant_id=$3',
        [JSON.stringify(pageIds), JSON.stringify(pageNames), tenantId]
      );
      res.json({ success: true, fullyDisconnected: false });
    }
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/integrations/meta/disconnect
router.delete('/meta/disconnect', checkPermission('meta_forms:delete'), async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM meta_integrations WHERE tenant_id=$1', [req.user!.tenantId]);
    await query('DELETE FROM meta_forms WHERE tenant_id=$1', [req.user!.tenantId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/integrations/waba/disconnect
router.delete('/waba/disconnect', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM waba_integrations WHERE tenant_id=$1', [req.user!.tenantId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── WABA ──────────────────────────────────────────────────────────────────────

// GET /api/integrations/waba/status
router.get('/waba/status', checkPermission('integrations:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT phone_number, phone_number_id, waba_id, is_active FROM waba_integrations WHERE tenant_id=$1',
      [req.user!.tenantId]
    );
    if (!result.rows[0]) {
      res.json({ connected: false });
      return;
    }
    const row = result.rows[0];
    res.json({ connected: true, phoneNumber: row.phone_number, phoneNumberId: row.phone_number_id, wabaId: row.waba_id, isActive: row.is_active });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/integrations/waba/stats
router.get('/waba/stats', checkPermission('integrations:view'), async (req: AuthRequest, res: Response) => {
  try {
    const tid = req.user!.tenantId;
    const [tplRes, convRes, msgRes, msgTodayRes] = await Promise.all([
      query(`SELECT COUNT(*) AS cnt FROM templates WHERE tenant_id=$1::uuid AND template_type='waba'`, [tid]),
      query(`SELECT COUNT(*) AS cnt FROM conversations WHERE tenant_id=$1::uuid AND channel='waba'`, [tid]),
      query(`SELECT COUNT(*) AS cnt FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.tenant_id=$1::uuid AND c.channel='waba'`, [tid]),
      query(`SELECT COUNT(*) AS cnt FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.tenant_id=$1::uuid AND c.channel='waba' AND m.created_at >= CURRENT_DATE`, [tid]),
    ]);
    res.json({
      templates: parseInt(tplRes.rows[0]?.cnt ?? '0'),
      conversations: parseInt(convRes.rows[0]?.cnt ?? '0'),
      totalMessages: parseInt(msgRes.rows[0]?.cnt ?? '0'),
      messagesToday: parseInt(msgTodayRes.rows[0]?.cnt ?? '0'),
    });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/integrations/waba/setup
router.post('/waba/setup', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { phone_number, phone_number_id, waba_id, access_token } = req.body as {
    phone_number?: string;
    phone_number_id?: string;
    waba_id?: string;
    access_token?: string;
  };
  if (!phone_number_id || !waba_id || !access_token) {
    res.status(400).json({ error: 'phone_number_id, waba_id, access_token are required' });
    return;
  }
  try {
    // Validate credentials against Meta Graph API
    const data = await graphGet(`/${phone_number_id}`, access_token);
    if (data.error) {
      res.status(400).json({ error: 'Invalid credentials: ' + (data.error.message ?? 'Unknown error') });
      return;
    }
    const resolvedPhone: string = phone_number ?? data.display_phone_number ?? '';
    const encrypted = encrypt(access_token);
    await query(
      `INSERT INTO waba_integrations (tenant_id, phone_number, phone_number_id, waba_id, access_token, is_active)
       VALUES ($1,$2,$3,$4,$5,TRUE)
       ON CONFLICT (tenant_id) DO UPDATE
         SET phone_number=$2, phone_number_id=$3, waba_id=$4, access_token=$5, is_active=TRUE, updated_at=NOW()`,
      [req.user!.tenantId, resolvedPhone, phone_number_id, waba_id, encrypted]
    );
    res.json({ success: true, status: 'active', phoneNumber: resolvedPhone });

    // Auto-sync WABA templates in background (fire-and-forget)
    syncWabaTemplates(req.user!.tenantId!, waba_id, access_token).catch((e) =>
      console.error('[WABA auto-sync templates]', e?.message ?? e)
    );
  } catch (err: any) {
    if (err?.code === 'ENOTFOUND') {
      res.status(400).json({ error: 'Could not reach Meta API. Check credentials.' });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

// Auto-sync WABA templates from Meta after connection
async function syncWabaTemplates(tenantId: string, wabaId: string, accessToken: string) {
  let allTemplates: any[] = [];
  let nextPath: string | null = `/${wabaId}/message_templates?fields=name,status,category,language,components&limit=100`;
  while (nextPath) {
    const data = await graphGet(nextPath, accessToken);
    if (data.error) { console.error('[WABA sync] Meta API error:', data.error.message); return; }
    allTemplates.push(...(data.data ?? []));
    const nextUrl: string | undefined = data.paging?.next;
    if (nextUrl) {
      try { nextPath = new URL(nextUrl).pathname + new URL(nextUrl).search; } catch { nextPath = null; }
    } else { nextPath = null; }
  }
  for (const tpl of allTemplates) {
    const components: any[] = tpl.components ?? [];
    const bodyComp = components.find((c: any) => c.type === 'BODY');
    const headerComp = components.find((c: any) => c.type === 'HEADER');
    const footerComp = components.find((c: any) => c.type === 'FOOTER');
    const buttonsComp = components.find((c: any) => c.type === 'BUTTONS');
    const displayName = (tpl.name as string).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    await query(
      `INSERT INTO templates
         (tenant_id, name, template_type, category, language, status, body, header, footer, buttons, meta_name, meta_components)
       VALUES ($1::uuid,$2,'waba',$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (tenant_id, meta_name, language) DO UPDATE SET
         name=EXCLUDED.name, category=EXCLUDED.category, status=EXCLUDED.status,
         body=EXCLUDED.body, header=EXCLUDED.header, footer=EXCLUDED.footer,
         buttons=EXCLUDED.buttons, meta_components=EXCLUDED.meta_components,
         updated_at=NOW()`,
      [tenantId, displayName, tpl.category ?? 'UTILITY', tpl.language ?? 'en',
       (tpl.status ?? 'PENDING').toLowerCase(), bodyComp?.text ?? '',
       headerComp?.format === 'TEXT' ? (headerComp.text ?? null) : null,
       footerComp?.text ?? null, JSON.stringify(buttonsComp?.buttons ?? []),
       tpl.name, JSON.stringify(components)]
    ).catch(() => null);
  }
  console.log(`[WABA sync] Synced ${allTemplates.length} templates for tenant ${tenantId}`);
}

// ── SMTP Email Integration ─────────────────────────────────────────────────────

// GET /api/integrations/smtp/status
router.get('/smtp/status', checkPermission('integrations:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT config_json, is_active FROM integration_configs WHERE tenant_id=$1 AND integration_id=$2',
      [req.user!.tenantId, 'smtp']
    );
    if (!result.rows[0]) { res.json({ connected: false, enabled: false }); return; }
    const cfg = result.rows[0].config_json ?? {};
    const isActive = result.rows[0].is_active;
    // Return config (minus password) + credits info
    const cred = await query('SELECT email_credits FROM tenants WHERE id=$1::uuid', [req.user!.tenantId]);
    const usage = await query('SELECT emails_sent FROM tenant_usage WHERE tenant_id=$1::uuid', [req.user!.tenantId]);
    res.json({
      connected: isActive && !!cfg.host,
      enabled: isActive,
      host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user,
      from_email: cfg.from_email, from_name: cfg.from_name,
      encryption: cfg.encryption || (cfg.secure ? 'ssl' : 'tls'),
      email_credits: cred.rows[0]?.email_credits ?? -1,
      emails_sent: usage.rows[0]?.emails_sent ?? 0,
    });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/integrations/smtp/setup
router.post('/smtp/setup', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { host, port, secure, user, password, from_email, from_name, encryption } = req.body as {
    host?: string; port?: number; secure?: boolean; user?: string; password?: string;
    from_email?: string; from_name?: string; encryption?: string;
  };
  if (!host || !user || !password) { res.status(400).json({ error: 'host, user and password are required' }); return; }
  const encryptedPassword = encrypt(password);
  const smtpConfig = {
    host, port: port ?? (encryption === 'ssl' ? 465 : 587),
    secure: encryption === 'ssl' ? true : secure ?? false,
    user, password: encryptedPassword,
    from_email: from_email || user,
    from_name: from_name || '',
    encryption: encryption || (secure ? 'ssl' : 'tls'),
  };
  try {
    await query(
      `INSERT INTO integration_configs (tenant_id, integration_id, config_json, is_active)
       VALUES ($1,'smtp',$2,TRUE)
       ON CONFLICT (tenant_id, integration_id) DO UPDATE SET config_json=$2, is_active=TRUE, updated_at=NOW()`,
      [req.user!.tenantId, JSON.stringify(smtpConfig)]
    );
    // Flush cached transporter so next send picks up new config
    const { invalidateTenantSmtpCache } = require('../services/email');
    invalidateTenantSmtpCache(req.user!.tenantId);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/integrations/smtp/test — verify SMTP connection (no email sent)
router.post('/smtp/test', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  try {
    const { testTenantSmtp } = require('../services/email');
    const result = await testTenantSmtp(req.user!.tenantId);
    if (result.success) {
      res.json({ success: true, message: 'SMTP connection verified successfully!' });
    } else {
      res.json({ success: false, error: result.error });
    }
  } catch (e: any) { res.status(500).json({ error: e.message ?? 'Server error' }); }
});

// POST /api/integrations/smtp/send-test — send a real test email
router.post('/smtp/send-test', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { to } = req.body as { to?: string };
  let recipient = to?.trim();
  if (!recipient) {
    // Fall back to current user's email
    const u = await query('SELECT email FROM users WHERE id=$1::uuid', [req.user!.userId]);
    recipient = u.rows[0]?.email;
  }
  if (!recipient) { res.status(400).json({ error: 'No recipient email' }); return; }
  try {
    const { sendEmail, getTenantEmailIdentity } = require('../services/email');
    const ident = await getTenantEmailIdentity(req.user!.tenantId);
    const brand = ident.fromName || 'DigyGo CRM';
    await sendEmail({
      to: recipient,
      subject: `Test Email from ${brand}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1c1410;margin:0 0 12px">Email Configuration Verified!</h2>
        <p style="color:#5c5245;font-size:14px">This is a test email from your <strong>${brand}</strong> CRM.</p>
        <p style="color:#5c5245;font-size:14px">If you received this, your SMTP settings are working correctly.</p>
        <p style="color:#9c8f84;font-size:12px;margin-top:20px">Sent at ${new Date().toLocaleString('en-IN')}</p>
      </div>`,
      fromName: ident.fromName,
      replyTo: ident.replyTo,
      tenantId: req.user!.tenantId,
    });
    res.json({ success: true, message: `Test email sent to ${recipient}` });
  } catch (e: any) {
    res.json({ success: false, error: e.message ?? 'Failed to send test email' });
  }
});

// PUT /api/integrations/smtp/toggle — enable or disable SMTP without deleting config
router.put('/smtp/toggle', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { enabled } = req.body as { enabled?: boolean };
  try {
    await query(
      'UPDATE integration_configs SET is_active=$1, updated_at=NOW() WHERE tenant_id=$2 AND integration_id=$3',
      [enabled !== false, req.user!.tenantId, 'smtp']
    );
    res.json({ success: true, enabled: enabled !== false });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/integrations/smtp/disconnect
router.delete('/smtp/disconnect', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query('UPDATE integration_configs SET is_active=FALSE WHERE tenant_id=$1 AND integration_id=$2', [req.user!.tenantId, 'smtp']);
    const { invalidateTenantSmtpCache } = require('../services/email');
    invalidateTenantSmtpCache(req.user!.tenantId);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Generic integration configs (Razorpay, n8n, etc.) ─────────────────────────

// GET /api/integrations/configs
router.get('/configs', checkPermission('integrations:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT integration_id, config_json, is_active FROM integration_configs WHERE tenant_id=$1',
      [req.user!.tenantId]
    );
    // Return as map { [integration_id]: { ...config, is_active } }
    const map: Record<string, any> = {};
    for (const row of result.rows) {
      map[row.integration_id] = { ...(row.config_json ?? {}), is_active: row.is_active };
    }
    res.json(map);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/integrations/configs/:integrationId — upsert config
router.post('/configs/:integrationId', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { api_key, webhook_url } = req.body as { api_key?: string; webhook_url?: string };
  if (!api_key && !webhook_url) { res.status(400).json({ error: 'api_key or webhook_url required' }); return; }
  const config = { api_key: api_key ?? null, webhook_url: webhook_url ?? null };
  try {
    await query(
      `INSERT INTO integration_configs (tenant_id, integration_id, config_json, is_active)
       VALUES ($1,$2,$3,TRUE)
       ON CONFLICT (tenant_id, integration_id) DO UPDATE SET config_json=$3, is_active=TRUE, updated_at=NOW()`,
      [req.user!.tenantId, req.params.integrationId, JSON.stringify(config)]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/integrations/configs/:integrationId — disconnect
router.delete('/configs/:integrationId', checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query(
      'UPDATE integration_configs SET is_active=FALSE WHERE tenant_id=$1 AND integration_id=$2',
      [req.user!.tenantId, req.params.integrationId]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Meta polling worker (backup for missed webhooks, runs every 5 min) ────────
// Paginated leadgen fetch over a window (since = epoch seconds). Returns ALL leads in the
// window (not just the first page) so the poll can re-scan a lookback and self-heal any
// missed lead. Surfaces the first Graph error (e.g. #190) so token failures are detected.
async function fetchLeadsSince(formId: string, token: string, since: number): Promise<{ leads: any[]; error: any }> {
  const out: any[] = [];
  let path = `/${formId}/leads?fields=id,created_time,field_data&since=${since}&limit=100`;
  for (let i = 0; i < 50; i++) { // safety cap: 50 pages
    const r = await graphGet(path, token);
    if (r && r.error) return { leads: out, error: r.error };
    const data: any[] = r?.data ?? [];
    out.push(...data);
    const after = r?.paging?.cursors?.after;
    if (!after || data.length === 0) break;
    path = `/${formId}/leads?fields=id,field_data&since=${since}&limit=100&after=${encodeURIComponent(after)}`;
  }
  return { leads: out, error: null };
}

// Records Meta ingestion health per tenant. On auth failure (invalid/expired token) it
// flags needs_reconnect and alerts the owner (deduped to once / 24h). On success it clears
// the flag and stamps last_success_at. Best-effort; never throws.
async function markMetaHealth(tenantId: string, ok: boolean, errMsg: string | null): Promise<void> {
  try {
    if (ok) {
      await query(
        `UPDATE meta_integrations SET needs_reconnect=FALSE, last_error=NULL, last_success_at=NOW() WHERE tenant_id=$1`,
        [tenantId]
      );
      return;
    }
    const r = await query(
      `UPDATE meta_integrations SET needs_reconnect=TRUE, last_error=$2, last_error_at=NOW()
       WHERE tenant_id=$1 RETURNING last_alert_at`,
      [tenantId, (errMsg ?? 'Meta API error').slice(0, 500)]
    );
    const lastAlert = r.rows[0]?.last_alert_at;
    const stale = !lastAlert || (Date.now() - new Date(lastAlert).getTime() > 24 * 3600 * 1000);
    if (stale) {
      await query(`UPDATE meta_integrations SET last_alert_at=NOW() WHERE tenant_id=$1`, [tenantId]);
      await sendIntegrationAlert(
        tenantId,
        'Facebook lead capture disconnected',
        'We can no longer pull leads from your Facebook page — the connection/token is no longer valid. New leads are NOT being captured. Please go to Integrations → Meta and reconnect to resume lead capture.'
      ).catch(() => {});
    }
  } catch (e: any) { console.error('[markMetaHealth]', e?.message); }
}

export async function pollMetaLeads(): Promise<void> {
  try {
    const formsRes = await query(
      `SELECT mf.*, mi.access_token AS enc_token
       FROM meta_forms mf
       JOIN meta_integrations mi ON mi.tenant_id = mf.tenant_id
       WHERE mf.is_active = TRUE`
    );

    const userTokenCache = new Map<string, string>();              // tenantId -> user token
    const pageTokenCache = new Map<string, Map<string, string>>(); // tenantId -> (pageId -> page token)
    const tenantStatus = new Map<string, { ok: boolean; err: string | null }>();

    for (const mf of formsRes.rows) {
      try {
        const tid: string = mf.tenant_id;
        let userTok = userTokenCache.get(tid);
        if (userTok === undefined) { try { userTok = decrypt(mf.enc_token); } catch { userTok = ''; } userTokenCache.set(tid, userTok); }
        let ptMap = pageTokenCache.get(tid);
        if (!ptMap) { ptMap = await buildPageTokenMap(userTok).catch(() => new Map<string, string>()); pageTokenCache.set(tid, ptMap); }
        // Leadgen (/{form}/leads) requires a PAGE token — the user token returns #190.
        // Fall back to the user token only if no page token could be derived.
        const token = (mf.page_id && ptMap.get(mf.page_id)) || userTok;
        // SELF-HEALING window: re-scan a SHORT fixed lookback every run as a safety net for
        // leads the (now page-token) webhook missed. Kept short so recovering from an outage can
        // never dump a large backlog at once — the old 72h window reached back to form activation
        // and flooded the CRM on reconnect. Dedup-by-leadgen_id makes re-scanning safe. Long
        // outages are recovered via the explicit Import button. `activated_at` is bumped to NOW()
        // on connect/reconnect/activation, so a reconnect pulls nothing.
        const LOOKBACK_S = 2 * 3600;  // 2h self-heal net (was 72h — caused the reconnect flood)
        const FRESH_S    = 2 * 3600;  // only replay automations for leads this fresh; older = silent recover
        const activatedFloor = Math.floor(new Date(mf.activated_at ?? mf.created_at ?? Date.now()).getTime() / 1000);
        const since = Math.max(Math.floor(Date.now() / 1000) - LOOKBACK_S, activatedFloor);

        // Paginated fetch of the whole window; surfaces #190 for token-health detection.
        const { leads: leadsArr, error: ge } = await fetchLeadsSince(mf.form_id, token, since);
        if (ge) {
          console.error(`[Meta poll] form ${mf.form_id} graph error:`, ge.message);
          if (ge.code === 190 || ge.type === 'OAuthException') {
            tenantStatus.set(tid, { ok: tenantStatus.get(tid)?.ok ?? false, err: ge.message });
          }
          continue;
        }
        if (tenantStatus.get(tid)?.ok !== true) tenantStatus.set(tid, { ok: true, err: tenantStatus.get(tid)?.err ?? null });
        const leads: Array<{ id: string; created_time?: string; field_data: Array<{ name: string; values: string[] }> }> = leadsArr;

        const mapping: Array<{ fb_field: string; crm_field: string }> = mf.field_mapping ?? [];
        let insertedCount = 0;

        for (const leadEntry of leads) {
          const leadgenId: string = leadEntry.id;
          if (!leadgenId) continue;

          // 1. True idempotency — skip if already in CRM
          const idem = await query(
            `SELECT id FROM leads WHERE source='meta_form' AND source_ref=$1 LIMIT 1`,
            [leadgenId]
          );
          if (idem.rows[0]) continue;

          // 2. Parse + normalize
          const { name, email, phone, customValues } = parseMetaFieldData(
            leadEntry.field_data ?? [],
            mapping
          );

          // 3. Email/phone dedup — scoped to the form's pipeline (multi-pipeline support).
          const existing = (email || phone) ? await query(
            `SELECT id FROM leads WHERE tenant_id=$1 AND is_deleted=FALSE
             AND (($2::text<>'' AND LOWER(email)=$2) OR ($3::text<>'' AND phone=$3))
             AND ($4::uuid IS NULL OR pipeline_id = $4::uuid) LIMIT 1`,
            [mf.tenant_id, email, phone, mf.pipeline_id ?? null]
          ) : { rows: [] };

          if (existing.rows[0]) continue;

          // 4. Insert — preserve the original Meta submission time (created_at + meta_created_at)
          //    so dates are correct and we can age-gate automations.
          const metaCreatedIso = leadEntry.created_time ? parseMetaTimestamp(leadEntry.created_time) : null;
          const newLead = await query(
            `INSERT INTO leads (tenant_id, name, email, phone, source, source_ref, meta_form_id, pipeline_id, stage_id, created_at, meta_created_at)
             VALUES ($1,$2,$3,$4,'meta_form',$5,$6,$7,$8, COALESCE($9::timestamptz, NOW()), $9::timestamptz) RETURNING *`,
            [mf.tenant_id, name, email, phone, leadgenId, mf.form_id, mf.pipeline_id ?? null, mf.stage_id ?? null, metaCreatedIso]
          );
          insertedCount++;

          const newLeadRow = newLead.rows[0];
          const leadId = newLeadRow?.id;
          if (leadId && Object.keys(customValues).length > 0) {
            await storeCustomValues(leadId, mf.tenant_id, customValues);
          }
          if (newLeadRow) {
            // Replay automations ONLY for genuinely-fresh leads. Older leads recovered by the
            // self-heal window are inserted silently — never an assign/route/webhook blast on a backlog.
            const ageMs  = metaCreatedIso ? (Date.now() - new Date(metaCreatedIso).getTime()) : 0;
            const isFresh = ageMs <= FRESH_S * 1000;
            sendNewLeadNotification(mf.tenant_id, newLeadRow, null).catch(() => null);
            if (isFresh) {
              const pollCtx = { ...newLeadRow, form_id: mf.form_id };
              setImmediate(() => triggerWorkflows('lead_created', pollCtx, mf.tenant_id, 'poll').catch(() => null));
              setImmediate(() => triggerWorkflows('meta_form',    pollCtx, mf.tenant_id, 'poll').catch(() => null));
            } else {
              console.log(`[Meta poll] recovered old lead ${leadgenId} (age ~${Math.round(ageMs/3600000)}h) — inserted, automations suppressed`);
            }
          }
        }

        await query(
          `UPDATE meta_forms SET leads_count=(SELECT COUNT(*) FROM leads WHERE meta_form_id=$1 AND tenant_id=$2 AND is_deleted=FALSE), last_sync_at=NOW() WHERE id=$3`,
          [mf.form_id, mf.tenant_id, mf.id]
        );
      } catch (e: any) { console.error('[Meta poll] form error', mf.form_id, e?.message); }
    }

    // Per-tenant health: flag reconnect on auth failure, otherwise clear + record success.
    for (const [tid, st] of tenantStatus) {
      if (st.err && !st.ok) await markMetaHealth(tid, false, st.err);
      else if (st.ok) await markMetaHealth(tid, true, null);
    }
  } catch (err) { console.error('[Meta poll error]', err); }
}

// ── Superfone Integration ─────────────────────────────────────────────────────

// POST /api/integrations/superfone/connect
router.post('/superfone/connect', requireSuperfone, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  const { api_key, superfone_endpoint_url, superfone_number } = req.body as {
    api_key?: string; superfone_endpoint_url?: string; superfone_number?: string;
  };
  if (!superfone_number?.trim()) {
    res.status(400).json({ error: 'Business phone number is required' });
    return;
  }
  try {
    const encKey = api_key?.trim() ? encrypt(api_key.trim()) : null;
    await query(
      `INSERT INTO superfone_settings (tenant_id, api_key_enc, superfone_endpoint_url, superfone_number, is_connected, connected_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, TRUE, NOW(), NOW())
       ON CONFLICT (tenant_id) DO UPDATE
         SET api_key_enc = COALESCE($2, superfone_settings.api_key_enc),
             superfone_endpoint_url = COALESCE($3, superfone_settings.superfone_endpoint_url),
             superfone_number = $4,
             is_connected = TRUE,
             connected_at = NOW(),
             updated_at = NOW()`,
      [req.user!.tenantId, encKey, superfone_endpoint_url?.trim() || null, superfone_number.trim()]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('[superfone connect]', err);
    res.status(500).json({ error: 'Failed to save Superfone settings' });
  }
});

// GET /api/integrations/superfone/status
router.get('/superfone/status', requireSuperfone, checkPermission('integrations:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT is_connected, superfone_number, connected_at FROM superfone_settings WHERE tenant_id=$1::uuid',
      [req.user!.tenantId]
    );
    if (!result.rows[0] || !result.rows[0].is_connected) {
      res.json({ connected: false });
      return;
    }
    const row = result.rows[0];
    res.json({
      connected: true,
      superfone_number: row.superfone_number,
      connected_at: row.connected_at,
    });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/integrations/superfone/disconnect
router.delete('/superfone/disconnect', requireSuperfone, checkPermission('integrations:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query(
      `UPDATE superfone_settings SET is_connected=FALSE, updated_at=NOW() WHERE tenant_id=$1::uuid`,
      [req.user!.tenantId]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

export default router;
