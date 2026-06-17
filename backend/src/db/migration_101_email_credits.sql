-- Add email_credits to tenants (-1 = unlimited, 0 = exhausted, >0 = remaining)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_credits INT NOT NULL DEFAULT -1;

-- Track emails sent per tenant
ALTER TABLE tenant_usage ADD COLUMN IF NOT EXISTS emails_sent INT NOT NULL DEFAULT 0;
