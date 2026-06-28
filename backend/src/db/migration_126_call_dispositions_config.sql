-- Migration 126: Add configurable call dispositions per tenant
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS call_dispositions JSONB;
