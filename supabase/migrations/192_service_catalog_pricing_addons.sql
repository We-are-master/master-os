-- Stackable add-ons per catalog service (e.g. oven clean on top of 1 bed EOT base).
-- Account-level overrides per preset/addon id live on account_service_prices.

ALTER TABLE public.service_catalog
  ADD COLUMN IF NOT EXISTS pricing_addons jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.service_catalog.pricing_addons IS
  'Optional stackable add-ons: [{ id, label, sort_order?, fixed_price, partner_cost? }]. Summed on top of selected pricing_presets base.';

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS catalog_pricing_addon_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.jobs.catalog_pricing_addon_ids IS
  'Ids from service_catalog.pricing_addons selected at job creation (stacked extras).';

ALTER TABLE public.account_service_prices
  ADD COLUMN IF NOT EXISTS preset_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.account_service_prices
  ADD COLUMN IF NOT EXISTS addon_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.account_service_prices.preset_overrides IS
  'Per-account base band overrides keyed by preset id: { [presetId]: { fixed_price?, partner_cost? } }.';

COMMENT ON COLUMN public.account_service_prices.addon_overrides IS
  'Per-account add-on overrides keyed by addon id: { [addonId]: { fixed_price, partner_cost? } }.';
