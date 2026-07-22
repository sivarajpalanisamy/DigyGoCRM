-- DigyGo CRM — Sprint 2 Migration
-- Migrate existing TEXT[] tags on leads to relational lead_tags junction table

DO $$
DECLARE
  r        RECORD;
  tag_name TEXT;
  tag_id   UUID;
BEGIN
  FOR r IN
    SELECT id, tenant_id, tags
    FROM   leads
    WHERE  tags IS NOT NULL
      AND  array_length(tags, 1) > 0
      AND  is_deleted = false
  LOOP
    FOREACH tag_name IN ARRAY r.tags LOOP
      tag_name := TRIM(tag_name);
      CONTINUE WHEN tag_name = '';
      -- Skip over-long values: tags.name is varchar(100). A handful of legacy leads
      -- have whole notes accidentally saved as a "tag" (>100 chars). They can't fit
      -- the column, and the app's own syncLeadTagsToJunction skips them the same way
      -- (its INSERT is .catch()-swallowed). Without this guard the 22001 error aborts
      -- the WHOLE DO block, so this backfill never committed and re-errored every deploy.
      CONTINUE WHEN char_length(tag_name) > 100;

      -- Find existing tag for this tenant, or create it
      SELECT id INTO tag_id
      FROM   tags
      WHERE  tenant_id = r.tenant_id AND name = tag_name;

      IF NOT FOUND THEN
        INSERT INTO tags (tenant_id, name, color)
        VALUES (r.tenant_id, tag_name, '#94a3b8')
        RETURNING id INTO tag_id;
      END IF;

      -- Associate tag with lead (ignore if already linked)
      INSERT INTO lead_tags (lead_id, tag_id)
      VALUES (r.id, tag_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
