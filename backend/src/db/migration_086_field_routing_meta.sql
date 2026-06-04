-- Named extra fields on routing rows.
-- Previously a routing row could only carry district + state as metadata, so a
-- column like "City" had to masquerade as "District". The meta column holds any
-- number of user-named fields ({slug: value}) that are written onto a routed lead
-- (custom_fields JSONB + lead_field_values), keyed by the slug the user chose.

ALTER TABLE field_routing_rows ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- DOWN MIGRATION (run manually if rollback needed)
-- ============================================================
-- ALTER TABLE field_routing_rows DROP COLUMN IF EXISTS meta;
-- ============================================================
