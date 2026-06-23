ALTER TABLE custom_forms ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
