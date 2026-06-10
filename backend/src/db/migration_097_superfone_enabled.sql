-- Per-tenant Superfone/Calls feature flag. Default OFF; DigyGo enables per client.
-- Backfill ON for tenants ALREADY using it so they don't lose Calls on deploy.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS superfone_enabled BOOLEAN DEFAULT FALSE;

UPDATE tenants SET superfone_enabled = TRUE
WHERE COALESCE(superfone_enabled, FALSE) = FALSE
  AND (
    id IN (SELECT tenant_id FROM superfone_settings WHERE is_connected = TRUE)
    OR id IN (SELECT DISTINCT tenant_id FROM call_logs)
  );
