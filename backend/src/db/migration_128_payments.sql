-- Payments table for Razorpay webhook integration
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  razorpay_payment_id VARCHAR(255),
  razorpay_order_id VARCHAR(255),
  amount INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  status VARCHAR(50) NOT NULL DEFAULT 'captured',
  method VARCHAR(50),
  email VARCHAR(255),
  phone VARCHAR(50),
  customer_name VARCHAR(255),
  description TEXT,
  notes JSONB DEFAULT '{}',
  raw_payload JSONB DEFAULT '{}',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_tenant_rp_id_idx ON payments(tenant_id, razorpay_payment_id);
CREATE INDEX IF NOT EXISTS payments_tenant_created_idx ON payments(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_lead_id_idx ON payments(lead_id);
