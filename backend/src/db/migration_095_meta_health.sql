-- Meta integration health tracking: detect when lead ingestion breaks (invalid token),
-- alert the owner, and surface a reconnect banner. All additive + idempotent.

ALTER TABLE meta_integrations ADD COLUMN IF NOT EXISTS needs_reconnect BOOLEAN DEFAULT FALSE;
ALTER TABLE meta_integrations ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE meta_integrations ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;
ALTER TABLE meta_integrations ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMPTZ;
ALTER TABLE meta_integrations ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;
