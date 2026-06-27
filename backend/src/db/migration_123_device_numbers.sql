-- Migration 099: Multiple verified numbers per device (dual-SIM support).
-- A device can have one number per SIM, each OTP-verified in the dashboard.

CREATE TABLE IF NOT EXISTS mobile_device_numbers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id     UUID NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number  VARCHAR(32) NOT NULL,
  sim_slot      INTEGER,
  verified      BOOLEAN NOT NULL DEFAULT FALSE,
  verify_method VARCHAR(20),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS mobile_device_numbers_uniq
  ON mobile_device_numbers(device_id, phone_number);
CREATE INDEX IF NOT EXISTS mobile_device_numbers_tenant_phone_idx
  ON mobile_device_numbers(tenant_id, phone_number);
