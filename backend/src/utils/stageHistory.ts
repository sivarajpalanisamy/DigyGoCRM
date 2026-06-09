import { query } from '../db';

// Record that a lead entered a stage (for the Stage Timeline). Skips if the lead's most
// recent history row is already this stage (avoids duplicate rows on no-op updates).
// Best-effort: never throws to the caller.
export async function recordStageEntry(
  leadId: string,
  tenantId: string,
  stageId: string | null | undefined,
  pipelineId?: string | null,
): Promise<void> {
  if (!leadId || !tenantId || !stageId) return;
  try {
    const last = await query(
      `SELECT stage_id FROM lead_stage_history WHERE lead_id=$1 ORDER BY entered_at DESC LIMIT 1`,
      [leadId],
    );
    if (last.rows[0] && last.rows[0].stage_id === stageId) return; // already in this stage
    const nm = await query(`SELECT name FROM pipeline_stages WHERE id=$1`, [stageId]);
    await query(
      `INSERT INTO lead_stage_history (lead_id, tenant_id, stage_id, pipeline_id, stage_name, entered_at)
       VALUES ($1,$2,$3,$4,$5,NOW())`,
      [leadId, tenantId, stageId, pipelineId ?? null, nm.rows[0]?.name ?? null],
    );
  } catch (e: any) { console.error('[recordStageEntry]', e?.message); }
}
