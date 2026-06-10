-- Store the original Meta lead submission time (created_time from the Graph API).
-- Without it, backfilled or poll-recovered leads were stamped with the ingestion time and
-- looked like they all arrived "today", and the poll could not tell a lead's real age.
-- NOTE never put a semicolon inside a comment here -- migrate.ts splits on every semicolon.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_created_at TIMESTAMPTZ;
