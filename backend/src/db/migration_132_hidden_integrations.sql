-- Add hidden_integrations column to tenants table
-- Super admin can hide specific integration cards per tenant
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS hidden_integrations TEXT[] NOT NULL DEFAULT '{}';
