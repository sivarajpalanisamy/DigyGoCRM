-- Clean up duplicate completed executions caused by the legacy double-fire bug
-- (webhooks.ts fired lead_created AND integrations.ts fired meta_form simultaneously).
-- Keep only the earliest completed record per workflow+lead, then delete the rest.

DELETE FROM workflow_execution_logs
WHERE execution_id IN (
  SELECT id FROM workflow_executions we
  WHERE status IN ('running', 'completed')
    AND EXISTS (
      SELECT 1 FROM workflow_executions earlier
      WHERE earlier.workflow_id = we.workflow_id
        AND earlier.lead_id     = we.lead_id
        AND earlier.status IN ('running', 'completed')
        AND earlier.enrolled_at < we.enrolled_at
    )
);

DELETE FROM workflow_executions we
WHERE status IN ('running', 'completed')
  AND EXISTS (
    SELECT 1 FROM workflow_executions earlier
    WHERE earlier.workflow_id = we.workflow_id
      AND earlier.lead_id     = we.lead_id
      AND earlier.status IN ('running', 'completed')
      AND earlier.enrolled_at < we.enrolled_at
  );

-- Now that duplicates are removed, create the unique guard index.
-- A second concurrent INSERT for the same workflow+lead with status='running'
-- will hit this constraint (23505) and be caught by the application as a
-- reentry block instead of creating a duplicate execution.

CREATE UNIQUE INDEX IF NOT EXISTS idx_wf_exec_one_enrollment
  ON workflow_executions (workflow_id, lead_id)
  WHERE status IN ('running', 'completed');
