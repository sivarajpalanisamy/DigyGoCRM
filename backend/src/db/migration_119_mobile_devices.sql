-- Migration 095: Mobile dialer app — device pairing, device tokens, mobile call source
-- Adds the DigyGo Dialer (Callyzer-style Android app) as a new authenticated call source.
-- Mirrors the refresh-token security model (bcrypt hash + 16-char indexed prefix).

-- ── Bound devices (one row per paired phone) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS mobile_devices (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_label         VARCHAR(120),
  device_token_hash    TEXT NOT NULL,
  device_token_prefix  VARCHAR(16) NOT NULL,
  platform             VARCHAR(20) DEFAULT 'android',
  app_version          VARCHAR(40),
  push_token           TEXT,
  last_seen_at         TIMESTAMPTZ,
  revoked              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS mobile_devices_token_prefix_idx
  ON mobile_devices(device_token_prefix);
CREATE INDEX IF NOT EXISTS mobile_devices_tenant_idx
  ON mobile_devices(tenant_id);
CREATE INDEX IF NOT EXISTS mobile_devices_user_idx
  ON mobile_devices(user_id);

-- ── One-time pairing codes (owner generates, staff redeems on the phone) ────────
CREATE TABLE IF NOT EXISTS device_pairing_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_label VARCHAR(120),
  code_hash    TEXT NOT NULL,
  code_prefix  VARCHAR(8) NOT NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used         BOOLEAN NOT NULL DEFAULT FALSE,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS device_pairing_codes_prefix_idx
  ON device_pairing_codes(code_prefix) WHERE used = FALSE;
CREATE INDEX IF NOT EXISTS device_pairing_codes_tenant_idx
  ON device_pairing_codes(tenant_id);

-- ── Extend call_logs so mobile-originated calls fit the existing table ──────────
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS disposition    VARCHAR(80);
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS notes          TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS source         VARCHAR(20) NOT NULL DEFAULT 'superfone';
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS device_id      UUID REFERENCES mobile_devices(id) ON DELETE SET NULL;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS client_call_id VARCHAR(80);

-- Mobile rows have no carrier CDR — drop the NOT NULL on cdr_id (idempotent).
DO $$
BEGIN
  ALTER TABLE call_logs ALTER COLUMN cdr_id DROP NOT NULL;
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- Offline-safe dedup: a phone may retry a batch, so dedup on the app-generated id.
CREATE UNIQUE INDEX IF NOT EXISTS call_logs_tenant_client_call_id_idx
  ON call_logs(tenant_id, client_call_id) WHERE client_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS call_logs_staff_user_idx
  ON call_logs(tenant_id, staff_user_id);
