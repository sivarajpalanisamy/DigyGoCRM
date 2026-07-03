-- Migration 128: Per-call SIM attribution on call_logs.
-- The mobile dialer now tags each synced call with the SIM slot + number it was
-- made/received on, so the backend can reject calls from SIMs that are NOT verified
-- for the device (dual-SIM: only calls on a CRM-verified number are logged).
-- Nullable + idempotent — pre-existing rows keep NULL and old app builds that don't
-- send attribution are unaffected.

ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS sim_slot   INTEGER;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS sim_number VARCHAR(32);
