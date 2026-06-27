-- Migration 098: Dashboard-side phone-number OTP verification for the dialer.
-- A CRM user registers a mobile number and verifies it with an OTP. When the same
-- number is later SIM-verified inside the app, the device binds to this tenant/user
-- and that number's calls (in + out) are recorded and synced.

CREATE TABLE IF NOT EXISTS dialer_number_verifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number  VARCHAR(32) NOT NULL,        -- normalized E.164
  otp_hash      TEXT,
  otp_expires_at TIMESTAMPTZ,
  otp_attempts  INTEGER NOT NULL DEFAULT 0,
  verified      BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at   TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One registration per number per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS dialer_number_tenant_phone_idx
  ON dialer_number_verifications(tenant_id, phone_number);

-- Fast lookup from the app side (match a verified number to its owner).
CREATE INDEX IF NOT EXISTS dialer_number_phone_verified_idx
  ON dialer_number_verifications(phone_number) WHERE verified = TRUE;
