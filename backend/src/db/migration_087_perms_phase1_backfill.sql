-- Phase 1 permission expansion: Opportunities and Tags were previously UNGATED
-- (any staff could use them). They are now enforced. To avoid stripping access from
-- existing staff, grant the new keys to every current permission row — but only when
-- a key is absent (idempotent; re-running on each deploy is a no-op and never
-- overwrites an admin's later choice).

UPDATE user_permissions SET permissions = permissions || '{"opportunities:read":true}'::jsonb   WHERE NOT (permissions ? 'opportunities:read');
UPDATE user_permissions SET permissions = permissions || '{"opportunities:create":true}'::jsonb WHERE NOT (permissions ? 'opportunities:create');
UPDATE user_permissions SET permissions = permissions || '{"opportunities:edit":true}'::jsonb   WHERE NOT (permissions ? 'opportunities:edit');
UPDATE user_permissions SET permissions = permissions || '{"opportunities:delete":true}'::jsonb WHERE NOT (permissions ? 'opportunities:delete');
UPDATE user_permissions SET permissions = permissions || '{"tags:view":true}'::jsonb            WHERE NOT (permissions ? 'tags:view');
UPDATE user_permissions SET permissions = permissions || '{"tags:manage":true}'::jsonb          WHERE NOT (permissions ? 'tags:manage');
