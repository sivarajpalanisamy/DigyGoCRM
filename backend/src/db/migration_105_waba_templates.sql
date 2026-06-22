-- WABA template sync: store the Meta-registered template name and raw components
ALTER TABLE templates ADD COLUMN IF NOT EXISTS meta_name VARCHAR(255);
ALTER TABLE templates ADD COLUMN IF NOT EXISTS meta_components JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_meta_name_lang
  ON templates(tenant_id, meta_name, language) WHERE meta_name IS NOT NULL;
