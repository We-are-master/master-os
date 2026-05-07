-- Optional price bands per catalog row (e.g. EICR by property size).
-- JSON array of { id, label, sort_order?, fixed_price?, hourly_rate?, default_hours?, partner_cost? }.

ALTER TABLE public.service_catalog
  ADD COLUMN IF NOT EXISTS pricing_presets jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.service_catalog.pricing_presets IS
  'Optional presets merged on top of row defaults before account/partner overrides.';

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS catalog_pricing_preset_id text NULL;

COMMENT ON COLUMN public.jobs.catalog_pricing_preset_id IS
  'Id of preset within service_catalog.pricing_presets when job was created with that band.';
