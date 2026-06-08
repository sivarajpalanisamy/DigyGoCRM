-- migration_092_leads_assign_perm
-- New permission leads:assign gates (re)assigning a lead (the assigned_to field).
-- Backfill for existing staff: grant it equal to their current staff:manage value, so
-- managers / full-access staff keep the ability and regular custom staff lose it
-- (they can no longer drop or hand off — incl. unassign themselves — a lead given to them).
-- Idempotent: only touches rows that do not already have the key.
-- NOTE: never put a semicolon character inside a comment here (the migrate splitter splits on it).

UPDATE user_permissions
SET permissions = permissions || jsonb_build_object(
  'leads:assign', COALESCE((permissions->>'staff:manage')::boolean, false)
)
WHERE NOT (permissions ? 'leads:assign');
