-- Persistent broadcast queue — survives PM2 restarts
CREATE TABLE IF NOT EXISTS broadcast_queue (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      UUID        NOT NULL,
  tenant_id        UUID        NOT NULL,
  lead_id          UUID        NOT NULL,
  broadcast_node_id TEXT,
  nodes            JSONB       NOT NULL DEFAULT '[]',
  trigger_type     TEXT        NOT NULL DEFAULT 'broadcast_group',
  allow_reentry    BOOLEAN     NOT NULL DEFAULT FALSE,
  send_at          TIMESTAMPTZ NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending',
  error            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  processed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_broadcast_queue_fire
  ON broadcast_queue(status, send_at)
  WHERE status = 'pending';
