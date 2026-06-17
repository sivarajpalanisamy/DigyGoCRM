-- Migration 102: Support multiple WhatsApp Personal sessions per tenant
-- Currently wa_personal_sessions has tenant_id as PK (one session per tenant).
-- We add a session_id UUID column and allow multiple rows per tenant.

-- 1. Add new columns
ALTER TABLE wa_personal_sessions ADD COLUMN IF NOT EXISTS session_id UUID DEFAULT gen_random_uuid();
ALTER TABLE wa_personal_sessions ADD COLUMN IF NOT EXISTS session_name VARCHAR(100) DEFAULT 'Default';

-- 2. Backfill session_id for existing rows
UPDATE wa_personal_sessions SET session_id = gen_random_uuid() WHERE session_id IS NULL;

-- 3. Drop old PK (tenant_id) and create new one (session_id)
DO $$ BEGIN
  ALTER TABLE wa_personal_sessions DROP CONSTRAINT IF EXISTS wa_personal_sessions_pkey;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE wa_personal_sessions ALTER COLUMN session_id SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE wa_personal_sessions ADD PRIMARY KEY (session_id);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 4. Index for tenant lookups
CREATE INDEX IF NOT EXISTS idx_wa_personal_sessions_tenant ON wa_personal_sessions(tenant_id);

-- 5. Update wa_personal_stats to optionally track per-session
ALTER TABLE wa_personal_stats ADD COLUMN IF NOT EXISTS session_id UUID;

-- 6. Session history also gets session_id
ALTER TABLE wa_session_history ADD COLUMN IF NOT EXISTS session_id UUID;
