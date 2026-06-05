-- Phase 3: granular view/export keys. Preserve current access exactly.
-- export was enforced but missing from full perms (nobody could export) so grant it
-- to broad-lead-viewers. pipeline read borrowed leads:view_own. calendar, followups
-- and call recordings reads were open, so view = true for all.
-- IMPORTANT keep comments free of semicolons (the splitter treats them as separators).

UPDATE user_permissions SET permissions = permissions || jsonb_build_object('leads:export', COALESCE((permissions->>'leads:view_all')::boolean, false)) WHERE NOT (permissions ? 'leads:export');
UPDATE user_permissions SET permissions = permissions || jsonb_build_object('contacts:export', COALESCE((permissions->>'leads:view_all')::boolean, false)) WHERE NOT (permissions ? 'contacts:export');
UPDATE user_permissions SET permissions = permissions || jsonb_build_object('pipeline:view', (COALESCE((permissions->>'leads:view_own')::boolean, false) OR COALESCE((permissions->>'leads:view_all')::boolean, false))) WHERE NOT (permissions ? 'pipeline:view');
UPDATE user_permissions SET permissions = permissions || '{"calendar:view":true}'::jsonb WHERE NOT (permissions ? 'calendar:view');
UPDATE user_permissions SET permissions = permissions || '{"followups:view":true}'::jsonb WHERE NOT (permissions ? 'followups:view');
UPDATE user_permissions SET permissions = permissions || '{"calls:recordings":true}'::jsonb WHERE NOT (permissions ? 'calls:recordings');
