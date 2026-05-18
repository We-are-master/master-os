-- Per-partner partner_cost overrides per catalog pricing preset / add-on id
-- (mirrors account_service_prices.preset_overrides / addon_overrides).

ALTER TABLE public.partner_service_prices
  ADD COLUMN IF NOT EXISTS preset_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.partner_service_prices
  ADD COLUMN IF NOT EXISTS addon_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.partner_service_prices.preset_overrides IS
  'Per-partner base preset pay overrides keyed by preset id: { [presetId]: { partner_cost? } }.';

COMMENT ON COLUMN public.partner_service_prices.addon_overrides IS
  'Per-partner add-on pay overrides keyed by addon id: { [addonId]: { partner_cost? } }.';
