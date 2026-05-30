-- Simplify Google Sheets integration: drop OAuth connection table,
-- add spreadsheet_url and gid columns to configs for public CSV access.

DROP TABLE IF EXISTS google_sheets_connections;

ALTER TABLE google_sheets_configs ADD COLUMN IF NOT EXISTS spreadsheet_url TEXT;
ALTER TABLE google_sheets_configs ADD COLUMN IF NOT EXISTS gid TEXT NOT NULL DEFAULT '0';
