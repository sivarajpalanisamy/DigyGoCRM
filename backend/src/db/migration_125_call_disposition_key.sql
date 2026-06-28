-- Migration 125: Add structured disposition_key to call_logs
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS disposition_key VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_call_logs_disposition_key ON call_logs(disposition_key) WHERE disposition_key IS NOT NULL;
