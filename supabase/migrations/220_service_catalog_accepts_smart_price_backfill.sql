-- Migration 220: Backfill accepts_smart_price for hourly / banded catalog rows.
-- Optional data fix after migration 219 (default false). Idempotent.

UPDATE public.service_catalog
SET accepts_smart_price = true,
    updated_at = now()
WHERE deleted_at IS NULL
  AND accepts_smart_price = false
  AND (
    pricing_mode = 'hourly'
    OR jsonb_array_length(COALESCE(pricing_presets, '[]'::jsonb)) > 0
  );
