-- Multi-pipeline support (part 2): email uniqueness must also be PER PIPELINE, not per tenant.
-- migration_099 relaxed phone uniqueness but left email unique per tenant, which still blocked a
-- contact (with an email) from existing in more than one pipeline. This mirrors 099 for email.
-- A null pipeline is coalesced to a fixed sentinel so routing-based (null-pipeline) leads still
-- cannot duplicate by email. Safe on existing data: current rows are unique per (tenant, email),
-- so they satisfy this looser rule and the index builds without conflict.
-- NOTE never put a semicolon inside a comment here -- migrate.ts splits on every semicolon.

DROP INDEX IF EXISTS idx_leads_unique_email_per_tenant;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_unique_email_per_pipeline
  ON leads (tenant_id, lower(email), COALESCE(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE email IS NOT NULL AND email <> '' AND is_deleted = FALSE;
