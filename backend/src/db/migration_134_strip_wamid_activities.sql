-- Clean the user-facing Activity Timeline: older automation runs mirrored the
-- technical WhatsApp message id ("(wamid: wamid.HBg...)") into
-- lead_activities.title. Strip that suffix from existing rows. Idempotent --
-- after the first run no row matches the LIKE filter. The full message with
-- wamid remains in workflow_execution_logs for delivery tracing.

UPDATE lead_activities
SET title = regexp_replace(title, '\s*\(wamid:[^)]*\)', '', 'g')
WHERE title LIKE '%(wamid:%';
