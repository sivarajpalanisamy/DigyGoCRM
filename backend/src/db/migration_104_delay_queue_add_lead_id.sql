-- Fix: add missing lead_id column to scheduled_workflow_steps
-- The original migration_014 created the table WITHOUT lead_id,
-- and migration_057/058 only tried DROP NOT NULL (which fails silently if column missing).
-- The INSERT in the delay action uses lead_id, causing:
--   "column lead_id of relation scheduled_workflow_steps does not exist"
-- This made all delay steps fail and workflows execute immediately.
ALTER TABLE scheduled_workflow_steps ADD COLUMN IF NOT EXISTS lead_id UUID;
