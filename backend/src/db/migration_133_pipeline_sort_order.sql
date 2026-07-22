-- Add sort_order to pipelines for drag-and-drop reordering
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Backfill existing pipelines: order by created_at per tenant
UPDATE pipelines p
SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at) - 1 AS rn
  FROM pipelines
) sub
WHERE p.id = sub.id AND p.sort_order = 0;
