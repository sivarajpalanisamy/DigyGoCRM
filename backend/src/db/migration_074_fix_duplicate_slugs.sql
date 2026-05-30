-- Fix cross-tenant slug collisions in custom_forms, booking_links,
-- landing_pages, and event_types so every slug is globally unique.
-- Keep oldest row unchanged and rename newer duplicates with -2/-3 suffix.

DO $$
DECLARE
  rec   RECORD;
  dup   RECORD;
  n     INT;
  new_slug TEXT;
BEGIN
  -- ── custom_forms ─────────────────────────────────────────────────────────────
  FOR rec IN
    SELECT slug FROM custom_forms GROUP BY slug HAVING COUNT(*) > 1
  LOOP
    n := 2;
    FOR dup IN
      SELECT id FROM custom_forms WHERE slug = rec.slug ORDER BY created_at ASC OFFSET 1
    LOOP
      LOOP
        new_slug := rec.slug || '-' || n;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM custom_forms WHERE slug = new_slug);
        n := n + 1;
      END LOOP;
      UPDATE custom_forms SET slug = new_slug WHERE id = dup.id;
      n := n + 1;
    END LOOP;
  END LOOP;

  -- ── booking_links ────────────────────────────────────────────────────────────
  FOR rec IN
    SELECT slug FROM booking_links GROUP BY slug HAVING COUNT(*) > 1
  LOOP
    n := 2;
    FOR dup IN
      SELECT id FROM booking_links WHERE slug = rec.slug ORDER BY created_at ASC OFFSET 1
    LOOP
      LOOP
        new_slug := rec.slug || '-' || n;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM booking_links WHERE slug = new_slug);
        n := n + 1;
      END LOOP;
      UPDATE booking_links SET slug = new_slug WHERE id = dup.id;
      n := n + 1;
    END LOOP;
  END LOOP;

  -- ── landing_pages ────────────────────────────────────────────────────────────
  FOR rec IN
    SELECT slug FROM landing_pages GROUP BY slug HAVING COUNT(*) > 1
  LOOP
    n := 2;
    FOR dup IN
      SELECT id FROM landing_pages WHERE slug = rec.slug ORDER BY created_at ASC OFFSET 1
    LOOP
      LOOP
        new_slug := rec.slug || '-' || n;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM landing_pages WHERE slug = new_slug);
        n := n + 1;
      END LOOP;
      UPDATE landing_pages SET slug = new_slug WHERE id = dup.id;
      n := n + 1;
    END LOOP;
  END LOOP;

  -- ── event_types ──────────────────────────────────────────────────────────────
  FOR rec IN
    SELECT slug FROM event_types GROUP BY slug HAVING COUNT(*) > 1
  LOOP
    n := 2;
    FOR dup IN
      SELECT id FROM event_types WHERE slug = rec.slug ORDER BY created_at ASC OFFSET 1
    LOOP
      LOOP
        new_slug := rec.slug || '-' || n;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM event_types WHERE slug = new_slug);
        n := n + 1;
      END LOOP;
      UPDATE event_types SET slug = new_slug WHERE id = dup.id;
      n := n + 1;
    END LOOP;
  END LOOP;

END $$;
