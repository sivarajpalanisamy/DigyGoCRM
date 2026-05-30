-- Google Sheets integration: OAuth connection + per-sheet sync configs

CREATE TABLE IF NOT EXISTS google_sheets_connections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  access_token  TEXT,
  refresh_token TEXT NOT NULL,
  token_expiry  TIMESTAMPTZ,
  email         TEXT,
  connected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS google_sheets_configs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  spreadsheet_id   TEXT NOT NULL,
  spreadsheet_name TEXT,
  sheet_name       TEXT NOT NULL,
  column_mapping   JSONB NOT NULL DEFAULT '{}',
  last_row_synced  INT NOT NULL DEFAULT 1,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gsheets_connections_tenant ON google_sheets_connections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gsheets_configs_tenant ON google_sheets_configs(tenant_id);
