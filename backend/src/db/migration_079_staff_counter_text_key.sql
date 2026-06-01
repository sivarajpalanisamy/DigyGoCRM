-- Fix round-robin pair counters: staff_id stored "pair_N" keys (text), not real UUIDs.
-- The UUID column type caused every INSERT to fail silently, so counters never incremented
-- and pair_0 was always selected, sending all leads to the first pair only.
ALTER TABLE workflow_staff_counters
  ALTER COLUMN staff_id TYPE TEXT USING staff_id::text;
