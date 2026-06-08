-- Admin/staff-settable login PIN per user (second factor, accepted alongside emailed one-time PIN).
-- Gated by the existing tenants.two_factor_enabled toggle. All additive and idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS login_pin_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_pin_set_by UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_pin_set_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_pin_attempts INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_pin_locked_until TIMESTAMPTZ;
