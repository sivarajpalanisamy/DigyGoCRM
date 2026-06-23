-- Add is_deleted column for soft delete support on landing_pages
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

-- Make slug globally unique (drop old per-tenant constraint, add global one)
-- The backend already checks slug uniqueness globally across all tenants
ALTER TABLE landing_pages DROP CONSTRAINT IF EXISTS landing_pages_tenant_id_slug_key;

-- Add global unique constraint only on non-deleted pages
CREATE UNIQUE INDEX IF NOT EXISTS landing_pages_slug_unique
  ON landing_pages (slug) WHERE is_deleted = FALSE;
