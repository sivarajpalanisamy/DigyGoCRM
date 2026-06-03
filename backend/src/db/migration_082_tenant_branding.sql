-- Tenant self-service branding fields (Branding page in Settings)
-- Note: logo_url and brand_color already added in migration_081
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS favicon_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS login_bg_color TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tab_title TEXT;
