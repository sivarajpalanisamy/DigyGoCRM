-- migration_091_perf_indexes
-- Performance indexes for large tenants (thousands of leads/contacts after CRM imports).
-- All IF NOT EXISTS so the migration is idempotent and safe to re-run.
-- NOTE: no semicolons inside comments (the migrate.ts splitter splits on every ';').

-- leads: the list query filters tenant_id + is_deleted and orders by created_at DESC.
CREATE INDEX IF NOT EXISTS idx_leads_tenant_active_created
  ON leads (tenant_id, is_deleted, created_at DESC);

-- leads: pipeline / stage / assignee filters used by the board and permission scoping.
CREATE INDEX IF NOT EXISTS idx_leads_tenant_active_pipeline
  ON leads (tenant_id, is_deleted, pipeline_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_active_stage
  ON leads (tenant_id, is_deleted, stage_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_active_assigned
  ON leads (tenant_id, is_deleted, assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_active_source
  ON leads (tenant_id, is_deleted, source);

-- contacts: list orders by created_at DESC within a tenant, and joins on lead_id.
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_created
  ON contacts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_lead
  ON contacts (lead_id);

-- lead_notes / activities: always fetched per lead, ordered by time.
CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_created
  ON lead_notes (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_created
  ON lead_activities (lead_id, created_at DESC);

-- lead_followups: per-lead lookups + the dashboard/overdue queries by due date.
CREATE INDEX IF NOT EXISTS idx_lead_followups_lead
  ON lead_followups (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_followups_tenant_due
  ON lead_followups (tenant_id, due_at);

-- lead_tags: join from tag side (lead side already indexed).
CREATE INDEX IF NOT EXISTS idx_lead_tags_tag
  ON lead_tags (tag_id);

-- lead_field_values: the /:id/fields upsert + read uses (lead_id, field_id).
CREATE INDEX IF NOT EXISTS idx_lead_field_values_lead_field
  ON lead_field_values (lead_id, field_id);
