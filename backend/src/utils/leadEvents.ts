import { query } from '../db';
import { emitToTenant } from '../socket';

/**
 * Re-fetch a lead with its assigned_name JOIN and broadcast `lead:created`
 * to the tenant room. Mirrors the payload shape emitted by POST /api/leads
 * so the frontend's onLeadCreated handler maps it correctly (stage resolved
 * client-side via stageMap from stage_id).
 *
 * Fire-and-forget safe: never throws.
 */
export async function emitLeadCreated(tenantId: string, leadId: string): Promise<void> {
  try {
    const r = await query(
      `SELECT l.*, u.name AS assigned_name
       FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.id = $1 AND l.tenant_id = $2`,
      [leadId, tenantId],
    );
    if (r.rows[0]) emitToTenant(tenantId, 'lead:created', r.rows[0]);
  } catch (e) {
    console.error('[emitLeadCreated]', e);
  }
}
