-- Track when auto-import was first activated per form.
-- Used as the initial since-cursor so the cron only fetches leads
-- submitted AFTER the user turned Auto ON, not 30 days of history.
ALTER TABLE meta_forms
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
