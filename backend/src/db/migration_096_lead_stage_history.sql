-- Per-lead stage history: one row each time a lead ENTERS a stage, so we can show how
-- long a lead stayed in each stage (manager view). stage_name is snapshotted so history
-- survives stage rename/delete. All idempotent.

CREATE TABLE IF NOT EXISTS lead_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  stage_id UUID,
  pipeline_id UUID,
  stage_name TEXT,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_stage_history_lead ON lead_stage_history(lead_id, entered_at);

-- Backfill 1: reconstruct entries from existing stage_change activities (entered_at = when moved)
INSERT INTO lead_stage_history (lead_id, tenant_id, stage_id, pipeline_id, stage_name, entered_at)
SELECT la.lead_id, la.tenant_id, ps.id, l.pipeline_id,
       trim(substring(la.title from 'Stage changed to (.*)$')),
       la.created_at
FROM lead_activities la
JOIN leads l ON l.id = la.lead_id AND l.is_deleted = FALSE
LEFT JOIN pipeline_stages ps ON ps.pipeline_id = l.pipeline_id
     AND lower(ps.name) = lower(trim(substring(la.title from 'Stage changed to (.*)$')))
WHERE la.type = 'stage_change'
  AND la.title LIKE 'Stage changed to %'
  AND NOT EXISTS (SELECT 1 FROM lead_stage_history h WHERE h.lead_id = la.lead_id AND h.entered_at = la.created_at);

-- Backfill 2: leads with no history yet get a single entry in their current stage at created_at
INSERT INTO lead_stage_history (lead_id, tenant_id, stage_id, pipeline_id, stage_name, entered_at)
SELECT l.id, l.tenant_id, l.stage_id, l.pipeline_id, ps.name, l.created_at
FROM leads l LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
WHERE l.is_deleted = FALSE AND l.stage_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM lead_stage_history h WHERE h.lead_id = l.id);
