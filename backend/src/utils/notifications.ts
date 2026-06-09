import { query } from '../db';
import { emitToUser } from '../socket';
import { sendEmail, isSmtpConfigured, getTenantEmailIdentity } from '../services/email';

// Alert owner + integration managers when an integration (e.g. Meta) breaks.
// In-app notification + email. Best-effort; never throws to the caller.
export async function sendIntegrationAlert(tenantId: string, title: string, message: string): Promise<void> {
  try {
    const recipients = new Set<string>();
    const ownerRow = await query(
      `SELECT id, email FROM users WHERE tenant_id=$1::uuid AND is_owner=TRUE AND is_active=TRUE LIMIT 1`, [tenantId]);
    if (ownerRow.rows[0]) recipients.add(ownerRow.rows[0].id);
    const mgrs = await query(
      `SELECT u.id FROM users u LEFT JOIN user_permissions up ON up.user_id=u.id
       WHERE u.tenant_id=$1::uuid AND u.is_active=TRUE AND u.is_owner IS NOT TRUE
         AND (up.permissions->>'integrations:manage')::boolean = TRUE`, [tenantId]);
    for (const r of mgrs.rows) recipients.add(r.id);

    for (const uid of recipients) {
      const n = await query(
        `INSERT INTO notifications (tenant_id, user_id, title, message, type)
         VALUES ($1::uuid,$2::uuid,$3,$4,'integration') RETURNING id, created_at`,
        [tenantId, uid, title, message]);
      if (n.rows[0]) emitToUser(uid, 'notification:new', {
        id: n.rows[0].id, type: 'integration', title, message, is_read: false, created_at: n.rows[0].created_at });
    }
    // Email the owner directly (independent of prefs — this is an outage alert)
    if (ownerRow.rows[0]?.email) {
      const ident = await getTenantEmailIdentity(tenantId);
      await sendEmail({
        to: ownerRow.rows[0].email,
        subject: title,
        fromName: ident.fromName,
        replyTo: ident.replyTo,
        html: `<div style="font-family:Arial,sans-serif;max-width:460px;margin:0 auto">
                 <p style="color:#1c1410;font-size:15px;font-weight:700">${title}</p>
                 <p style="color:#5c5245;font-size:14px">${message}</p></div>`,
      }).catch(() => {});
    }
  } catch (e: any) { console.error('[sendIntegrationAlert]', e?.message); }
}

// Fix 9: batch-fetch prefs for a set of user IDs
async function batchGetPrefs(
  userIds: string[],
): Promise<Map<string, Record<string, { inApp: boolean; email: boolean }>>> {
  if (userIds.length === 0) return new Map();
  const res = await query(
    `SELECT user_id, prefs FROM notification_preferences WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  const map = new Map<string, Record<string, { inApp: boolean; email: boolean }>>();
  for (const row of res.rows) map.set(row.user_id, row.prefs ?? {});
  return map;
}

// Fix 9: return false only when preference explicitly set inApp=false
function prefAllows(
  prefs: Record<string, { inApp: boolean; email: boolean }> | undefined,
  type: string,
): boolean {
  if (!prefs) return true;
  const p = prefs[type];
  if (!p) return true;
  return p.inApp !== false;
}

// Email a notification to recipients who explicitly enabled email for this type (prefs[type].email === true).
// Opt-IN by default off — only sends when the user turned the email toggle on. Fire-and-forget.
async function emailNotificationRecipients(
  tenantId: string,
  userIds: string[],
  prefsMap: Map<string, Record<string, { inApp: boolean; email: boolean }>>,
  type: string,
  title: string,
  message: string,
): Promise<void> {
  try {
    const emailIds = userIds.filter((id) => prefsMap.get(id)?.[type]?.email === true);
    if (emailIds.length === 0 || !isSmtpConfigured()) return;
    const rows = (await query(
      `SELECT email FROM users WHERE id = ANY($1::uuid[]) AND email IS NOT NULL AND email <> ''`,
      [emailIds],
    )).rows;
    if (rows.length === 0) return;
    const ident = await getTenantEmailIdentity(tenantId);
    const brand = ident.fromName || 'DigyGo CRM';
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#1c1410;font-size:18px;margin:0 0 8px">${title}</h2>
      <p style="color:#5c5245;font-size:14px;margin:0 0 16px">${message}</p>
      <p style="color:#9c8f84;font-size:12px">— ${brand}</p>
    </div>`;
    for (const r of rows) {
      sendEmail({ to: r.email, subject: title, html, fromName: ident.fromName, replyTo: ident.replyTo })
        .catch((e) => console.error('[notif email]', type, e?.message));
    }
  } catch (e) {
    console.error('[emailNotificationRecipients]', e);
  }
}

/**
 * Sends a "new lead" in-app notification to:
 *  1. The tenant owner (always)
 *  2. Staff members with staff:manage permission (excluding the creator)
 *  3. The assigned staff member, if set and not the creator
 * Fix 9: skips recipients who turned off new_lead in-app notifications
 */
export async function sendNewLeadNotification(
  tenantId: string,
  lead: {
    id: string;
    name: string;
    source?: string;
    pipeline_id?: string;
    stage_id?: string;
    assigned_to?: string;
  },
  creatorUserId: string | null,
): Promise<void> {
  const recipientSet = new Set<string>();

  const ownerRow = await query(
    `SELECT id FROM users WHERE tenant_id = $1::uuid AND is_owner = TRUE AND is_active = TRUE LIMIT 1`,
    [tenantId],
  );
  if (ownerRow.rows[0]) recipientSet.add(ownerRow.rows[0].id);

  const managers = await query(
    `SELECT u.id FROM users u
     LEFT JOIN user_permissions up ON up.user_id = u.id
     WHERE u.tenant_id = $1::uuid
       AND u.is_active = TRUE
       AND u.is_owner IS NOT TRUE
       AND ($2::uuid IS NULL OR u.id != $2::uuid)
       AND (up.permissions->>'staff:manage')::boolean = TRUE`,
    [tenantId, creatorUserId ?? null],
  );
  for (const row of managers.rows) recipientSet.add(row.id);

  if (lead.assigned_to && lead.assigned_to !== creatorUserId) {
    recipientSet.add(lead.assigned_to);
  }

  if (recipientSet.size === 0) return;

  // Fix 9: filter by preference
  const allIds = [...recipientSet];
  const prefsMap = await batchGetPrefs(allIds);
  const filteredIds = allIds.filter((id) => prefAllows(prefsMap.get(id), 'new_lead'));
  if (filteredIds.length === 0) return;

  const pipelineInfo = await query(
    `SELECT p.name AS pipeline_name, ps.name AS stage_name
     FROM pipelines p
     LEFT JOIN pipeline_stages ps ON ps.id = $1::uuid AND ps.pipeline_id = p.id
     WHERE p.id = $2::uuid`,
    [lead.stage_id ?? null, lead.pipeline_id ?? null],
  );
  const { pipeline_name = '', stage_name = '' } = pipelineInfo.rows[0] ?? {};
  const notifTitle = `New Lead: ${lead.name}`;
  const notifMessage = pipeline_name
    ? `Added to ${pipeline_name}${stage_name ? ` · ${stage_name}` : ''}`
    : `Source: ${lead.source || 'Manual'}`;

  for (const uid of filteredIds) {
    const nRes = await query(
      `INSERT INTO notifications (tenant_id, user_id, title, message, type, lead_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'new_lead', $5::uuid) RETURNING id, created_at`,
      [tenantId, uid, notifTitle, notifMessage, lead.id],
    );
    if (nRes.rows[0]) {
      emitToUser(uid, 'notification:new', {
        id:         nRes.rows[0].id,
        type:       'new_lead',
        title:      notifTitle,
        message:    notifMessage,
        lead_id:    lead.id,
        is_read:    false,
        created_at: nRes.rows[0].created_at,
      });
    }
  }
  // Email recipients who enabled email for new_lead (independent of in-app pref)
  await emailNotificationRecipients(tenantId, allIds, prefsMap, 'new_lead', notifTitle, notifMessage);
}

/**
 * Fix 6: Notify when a lead is (re)assigned to a staff member.
 * Only fires when assigned_to changes and the new assignee is not the person making the change.
 */
export async function sendLeadAssignedNotification(
  tenantId: string,
  lead: { id: string; name: string },
  assignedToUserId: string,
  assignedByUserId: string | null,
): Promise<void> {
  if (!assignedToUserId || assignedToUserId === assignedByUserId) return;

  const prefsMap = await batchGetPrefs([assignedToUserId]);
  const notifTitle = `Lead Assigned: ${lead.name}`;
  const notifMessage = 'A lead has been assigned to you';

  // In-app (unless user turned it off)
  if (prefAllows(prefsMap.get(assignedToUserId), 'assigned')) {
    const nRes = await query(
      `INSERT INTO notifications (tenant_id, user_id, title, message, type, lead_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'assigned', $5::uuid) RETURNING id, created_at`,
      [tenantId, assignedToUserId, notifTitle, notifMessage, lead.id],
    );
    if (nRes.rows[0]) {
      emitToUser(assignedToUserId, 'notification:new', {
        id:         nRes.rows[0].id,
        type:       'assigned',
        title:      notifTitle,
        message:    notifMessage,
        lead_id:    lead.id,
        is_read:    false,
        created_at: nRes.rows[0].created_at,
      });
    }
  }
  // Email (only if user enabled email for 'assigned')
  await emailNotificationRecipients(tenantId, [assignedToUserId], prefsMap, 'assigned', notifTitle, notifMessage);
}

/**
 * Fix 7: Single summary notification after bulk import instead of one per lead.
 * Sent to the importer + owner + managers.
 */
export async function sendBulkImportNotification(
  tenantId: string,
  importedCount: number,
  importerUserId: string,
): Promise<void> {
  if (importedCount === 0) return;

  const recipientSet = new Set<string>([importerUserId]);

  const ownerRow = await query(
    `SELECT id FROM users WHERE tenant_id = $1::uuid AND is_owner = TRUE AND is_active = TRUE LIMIT 1`,
    [tenantId],
  );
  if (ownerRow.rows[0]) recipientSet.add(ownerRow.rows[0].id);

  const managers = await query(
    `SELECT u.id FROM users u
     LEFT JOIN user_permissions up ON up.user_id = u.id
     WHERE u.tenant_id = $1::uuid
       AND u.is_active = TRUE
       AND u.is_owner IS NOT TRUE
       AND u.id != $2::uuid
       AND (up.permissions->>'staff:manage')::boolean = TRUE`,
    [tenantId, importerUserId],
  );
  for (const row of managers.rows) recipientSet.add(row.id);

  const allIds = [...recipientSet];
  const prefsMap = await batchGetPrefs(allIds);
  const filteredIds = allIds.filter((id) => prefAllows(prefsMap.get(id), 'new_lead'));
  if (filteredIds.length === 0) return;

  const notifTitle = `${importedCount} Lead${importedCount > 1 ? 's' : ''} Imported`;
  const notifMessage = `Bulk import completed — ${importedCount} new lead${importedCount > 1 ? 's' : ''} added`;

  for (const uid of filteredIds) {
    const nRes = await query(
      `INSERT INTO notifications (tenant_id, user_id, title, message, type)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'new_lead') RETURNING id, created_at`,
      [tenantId, uid, notifTitle, notifMessage],
    );
    if (nRes.rows[0]) {
      emitToUser(uid, 'notification:new', {
        id:         nRes.rows[0].id,
        type:       'new_lead',
        title:      notifTitle,
        message:    notifMessage,
        is_read:    false,
        created_at: nRes.rows[0].created_at,
      });
    }
  }
  await emailNotificationRecipients(tenantId, allIds, prefsMap, 'new_lead', notifTitle, notifMessage);
}

/**
 * Notify staff + owner/managers when a Superfone call is logged.
 * For missed calls, also notifies the lead's assigned staff member.
 */
export async function sendCallLoggedNotification(
  tenantId: string,
  callLog: {
    id: string;
    leadId: string | null;
    leadName: string | null;
    isUnknown: boolean;
    direction: string;
    outcome: string;
    callerPhone: string | null;
    duration: number | null;
    staffName: string | null;
    staffUserId: string | null;
  }
): Promise<void> {
  const isMissed = callLog.outcome !== 'ANSWERED';
  const recipientSet = new Set<string>();

  // Always notify the staff member who handled the call
  if (callLog.staffUserId) recipientSet.add(callLog.staffUserId);

  // For missed calls: also notify owner + managers + lead's assigned staff
  if (isMissed) {
    const ownerRow = await query(
      `SELECT id FROM users WHERE tenant_id=$1::uuid AND is_owner=TRUE AND is_active=TRUE LIMIT 1`,
      [tenantId]
    );
    if (ownerRow.rows[0]) recipientSet.add(ownerRow.rows[0].id);

    const managers = await query(
      `SELECT u.id FROM users u
       LEFT JOIN user_permissions up ON up.user_id = u.id
       WHERE u.tenant_id=$1::uuid AND u.is_active=TRUE AND u.is_owner IS NOT TRUE
         AND (up.permissions->>'staff:manage')::boolean = TRUE`,
      [tenantId]
    );
    for (const row of managers.rows) recipientSet.add(row.id);

    if (callLog.leadId) {
      const assignedRow = await query(
        `SELECT assigned_to FROM leads WHERE id=$1::uuid AND is_deleted=FALSE`,
        [callLog.leadId]
      );
      if (assignedRow.rows[0]?.assigned_to) recipientSet.add(assignedRow.rows[0].assigned_to);
    }
  }

  if (recipientSet.size === 0) return;

  const type = isMissed ? 'call_missed' : 'call_received';
  const display = callLog.leadName ?? callLog.callerPhone ?? 'Unknown';
  const durationStr = callLog.duration
    ? ` (${Math.floor(callLog.duration / 60)}m ${callLog.duration % 60}s)`
    : '';
  const dirLabel = callLog.direction === 'INBOUND' ? 'Inbound' : 'Outbound';

  const title = isMissed
    ? `Missed call from ${display}`
    : `${dirLabel} call: ${display} — Answered${durationStr}`;
  const message = callLog.staffName ? `Handled by ${callLog.staffName}` : 'No agent assigned';

  const allIds = [...recipientSet];
  const prefsMap = await batchGetPrefs(allIds);
  const filteredIds = allIds.filter((id) => prefAllows(prefsMap.get(id), type));
  if (filteredIds.length === 0) return;

  for (const uid of filteredIds) {
    const nRes = callLog.leadId
      ? await query(
          `INSERT INTO notifications (tenant_id, user_id, title, message, type, lead_id)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid) RETURNING id, created_at`,
          [tenantId, uid, title, message, type, callLog.leadId]
        )
      : await query(
          `INSERT INTO notifications (tenant_id, user_id, title, message, type)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING id, created_at`,
          [tenantId, uid, title, message, type]
        );
    if (nRes.rows[0]) {
      emitToUser(uid, 'notification:new', {
        id:         nRes.rows[0].id,
        type,
        title,
        message,
        lead_id:    callLog.leadId ?? undefined,
        is_read:    false,
        created_at: nRes.rows[0].created_at,
      });
    }
  }
  await emailNotificationRecipients(tenantId, allIds, prefsMap, type, title, message);
}

/**
 * Runs every 5 minutes. Finds follow-ups due within the next 30 minutes
 * that haven't had a reminder sent yet, sends an in-app notification to
 * the assigned staff member, and marks reminder_sent = TRUE.
 */
export async function processFollowUpReminders(): Promise<void> {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 60 * 1000);

  // Fetch follow-ups due in the next 30 minutes, not completed, reminder not sent
  const fus = await query(
    `SELECT f.id, f.lead_id, f.tenant_id, f.title, f.due_at, f.assigned_to,
            l.first_name || ' ' || l.last_name AS lead_name
     FROM lead_followups f
     JOIN leads l ON l.id = f.lead_id AND l.is_deleted = FALSE
     WHERE f.completed = FALSE
       AND f.reminder_sent = FALSE
       AND f.due_at >= $1
       AND f.due_at <= $2`,
    [now.toISOString(), in30.toISOString()],
  );

  for (const fu of fus.rows) {
    // Mark reminder_sent immediately to prevent double-sending
    await query(
      `UPDATE lead_followups SET reminder_sent = TRUE WHERE id = $1`,
      [fu.id],
    );

    if (!fu.assigned_to) continue;

    const prefsMap = await batchGetPrefs([fu.assigned_to]);
    const dueDate = new Date(fu.due_at);
    const minutesLeft = Math.round((dueDate.getTime() - now.getTime()) / 60000);
    const notifTitle = `Follow-up due soon: ${fu.title}`;
    const notifMessage = `Lead: ${fu.lead_name} — due in ${minutesLeft} min`;

    // In-app (unless turned off)
    if (prefAllows(prefsMap.get(fu.assigned_to), 'follow_up_due')) {
      const nRes = await query(
        `INSERT INTO notifications (tenant_id, user_id, title, message, type, lead_id)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'follow_up_due', $5::uuid) RETURNING id, created_at`,
        [fu.tenant_id, fu.assigned_to, notifTitle, notifMessage, fu.lead_id],
      );
      if (nRes.rows[0]) {
        emitToUser(fu.assigned_to, 'notification:new', {
          id:         nRes.rows[0].id,
          type:       'follow_up_due',
          title:      notifTitle,
          message:    notifMessage,
          lead_id:    fu.lead_id,
          is_read:    false,
          created_at: nRes.rows[0].created_at,
        });
      }
    }
    // Email (only if user enabled email for follow_up_due)
    await emailNotificationRecipients(fu.tenant_id, [fu.assigned_to], prefsMap, 'follow_up_due', notifTitle, notifMessage);
  }
}
