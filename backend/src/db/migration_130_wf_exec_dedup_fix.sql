-- Fix workflow execution dedup race condition:
-- The partial unique index only covered 'running' and 'completed' statuses.
-- If execution #1 moved to 'failed' before execution #2 inserted, the index
-- would not block the duplicate, allowing the same workflow to run twice
-- for the same lead and send duplicate messages.
-- Fix: include 'failed' and 'completed_with_errors' in the index.

DROP INDEX IF EXISTS idx_wf_exec_one_enrollment;

CREATE UNIQUE INDEX idx_wf_exec_one_enrollment
  ON workflow_executions (workflow_id, lead_id)
  WHERE status IN ('running', 'completed', 'failed', 'completed_with_errors');
