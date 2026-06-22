CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  template_id UUID,
  template_name VARCHAR(255),
  template_meta_name VARCHAR(255),
  template_body TEXT,
  template_header TEXT,
  template_footer TEXT,
  total_leads INT DEFAULT 0,
  sent INT DEFAULT 0,
  failed INT DEFAULT 0,
  skipped INT DEFAULT 0,
  delivered INT DEFAULT 0,
  read_count INT DEFAULT 0,
  error_details JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'sending',
  filters JSONB DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_tenant ON broadcasts(tenant_id, created_at DESC);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS broadcast_id UUID REFERENCES broadcasts(id);

CREATE INDEX IF NOT EXISTS idx_messages_broadcast ON messages(broadcast_id) WHERE broadcast_id IS NOT NULL;
