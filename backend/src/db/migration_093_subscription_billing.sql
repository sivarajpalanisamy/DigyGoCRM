-- migration_093_subscription_billing
-- Monthly/Yearly subscription model + auto-block-on-expiry support.
-- Adds billing columns. SAFE one-time backfill: every CURRENT tenant becomes
-- perpetual + active (and any PAST expiry is cleared) so enabling enforcement
-- never surprise-blocks an existing client. The super admin then sets real dates.
-- The backfill keys on subscription_started_at IS NULL so it runs exactly ONCE
-- and never clobbers dates an admin sets later.
-- NOTE: never put a semicolon character inside a comment here (the migrate splitter splits on it).

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'monthly';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_price NUMERIC;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_days INT DEFAULT 0;

UPDATE tenants
SET subscription_started_at = now(),
    subscription_status     = COALESCE(subscription_status, 'active'),
    subscription_expires_at = CASE
       WHEN subscription_expires_at IS NOT NULL AND subscription_expires_at < now()
       THEN NULL ELSE subscription_expires_at END
WHERE subscription_started_at IS NULL;
