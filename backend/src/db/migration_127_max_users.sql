-- Add per-tenant user license limit
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_users INT DEFAULT 5;
