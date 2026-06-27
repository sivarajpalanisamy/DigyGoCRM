-- Migration 097: Phone-number verification for mobile devices
-- The device now logs in (email/password) then verifies its SIM phone number.
-- These columns record the verified number, how it was verified, and SIM details.

ALTER TABLE mobile_devices ADD COLUMN IF NOT EXISTS phone_number   VARCHAR(32);
ALTER TABLE mobile_devices ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mobile_devices ADD COLUMN IF NOT EXISTS verify_method  VARCHAR(20);
ALTER TABLE mobile_devices ADD COLUMN IF NOT EXISTS sim_info       JSONB;

CREATE INDEX IF NOT EXISTS mobile_devices_phone_idx
  ON mobile_devices(tenant_id, phone_number) WHERE phone_number IS NOT NULL;
