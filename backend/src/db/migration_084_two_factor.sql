-- Two-factor authentication (email OTP) — opt-in per tenant
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;

-- Per-user OTP challenge state (transient during a login attempt)
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_attempts INT DEFAULT 0;

-- Remembered devices that skip OTP for 30 days
CREATE TABLE IF NOT EXISTS trusted_devices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trusted_devices_user_idx ON trusted_devices(user_id);
