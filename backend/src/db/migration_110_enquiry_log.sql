-- Enquiry log: records every form submission for full journey tracking
-- Even when dedup merges a lead, this log preserves the submission event

CREATE TABLE IF NOT EXISTS enquiry_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  phone       VARCHAR(50),
  email       VARCHAR(255),
  lead_id     UUID REFERENCES leads(id) ON DELETE SET NULL,
  form_type   VARCHAR(50) NOT NULL,
  form_id     VARCHAR(255),
  form_name   VARCHAR(255),
  pipeline_id UUID REFERENCES pipelines(id) ON DELETE SET NULL,
  pipeline_name VARCHAR(255),
  stage_id    UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  stage_name  VARCHAR(255),
  source      VARCHAR(255),
  is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  raw_data    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enquiry_log_tenant ON enquiry_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_enquiry_log_phone ON enquiry_log(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enquiry_log_email ON enquiry_log(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enquiry_log_lead ON enquiry_log(lead_id) WHERE lead_id IS NOT NULL;
