-- Migration 096: Backfill devices:view / devices:manage permission keys
-- Idempotent — only adds the keys to staff rows that don't already have them, so no
-- existing staff loses access. Both default FALSE (device management is owner-only by
-- default). Mirrors migrations 087-092.

UPDATE user_permissions
SET permissions = permissions || '{"devices:view":false,"devices:manage":false}'::jsonb
WHERE NOT (permissions ? 'devices:manage');
