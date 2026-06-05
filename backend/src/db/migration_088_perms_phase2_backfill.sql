-- Phase 2: dedicated keys for previously "borrowed" admin features.
-- Reads were open, writes used settings:manage / automation:manage. Preserve exact
-- current access: views = true for everyone (reads were open), manage = the value of
-- the key it used to borrow. Idempotent (only sets a key when absent).
-- IMPORTANT keep comments free of semicolons (the migration splitter splits on them).

UPDATE user_permissions SET permissions = permissions || '{"assignment_rules:view":true}'::jsonb WHERE NOT (permissions ? 'assignment_rules:view');
UPDATE user_permissions SET permissions = permissions || jsonb_build_object('assignment_rules:manage', COALESCE((permissions->>'settings:manage')::boolean, false)) WHERE NOT (permissions ? 'assignment_rules:manage');
UPDATE user_permissions SET permissions = permissions || '{"routing:view":true}'::jsonb WHERE NOT (permissions ? 'routing:view');
UPDATE user_permissions SET permissions = permissions || jsonb_build_object('routing:manage', COALESCE((permissions->>'settings:manage')::boolean, false)) WHERE NOT (permissions ? 'routing:manage');
UPDATE user_permissions SET permissions = permissions || '{"whatsapp_flows:view":true}'::jsonb WHERE NOT (permissions ? 'whatsapp_flows:view');
UPDATE user_permissions SET permissions = permissions || jsonb_build_object('whatsapp_flows:manage', COALESCE((permissions->>'automation:manage')::boolean, false)) WHERE NOT (permissions ? 'whatsapp_flows:manage');
