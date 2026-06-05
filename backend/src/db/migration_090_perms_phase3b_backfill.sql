-- Phase 3b: split settings:manage into company/branding/security, and add inbox:assign.
-- Endpoints accept the master key OR the sub-key, so nothing breaks. Preserve access:
-- each settings sub-key = current settings:manage value, inbox:assign = inbox:send value.
-- IMPORTANT keep comments free of semicolons (the splitter treats them as separators).

UPDATE user_permissions SET permissions = permissions || jsonb_build_object('settings:company', COALESCE((permissions->>'settings:manage')::boolean, false)) WHERE NOT (permissions ? 'settings:company');
UPDATE user_permissions SET permissions = permissions || jsonb_build_object('settings:branding', COALESCE((permissions->>'settings:manage')::boolean, false)) WHERE NOT (permissions ? 'settings:branding');
UPDATE user_permissions SET permissions = permissions || jsonb_build_object('settings:security', COALESCE((permissions->>'settings:manage')::boolean, false)) WHERE NOT (permissions ? 'settings:security');
UPDATE user_permissions SET permissions = permissions || jsonb_build_object('inbox:assign', COALESCE((permissions->>'inbox:send')::boolean, false)) WHERE NOT (permissions ? 'inbox:assign');
