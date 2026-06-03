-- Tenant self-service branding fields (Branding page in Settings)
-- logo_url and brand_color already exist (migration_081); add the rest.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS favicon_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS login_bg_color TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tab_title TEXT;

-- ============================================================
-- DOWN MIGRATION (run manually if rollback needed)
-- ============================================================
-- ALTER TABLE tenants DROP COLUMN IF EXISTS favicon_url;
-- ALTER TABLE tenants DROP COLUMN IF EXISTS banner_url;
-- ALTER TABLE tenants DROP COLUMN IF EXISTS login_bg_color;
-- ALTER TABLE tenants DROP COLUMN IF EXISTS tab_title;
-- ============================================================
