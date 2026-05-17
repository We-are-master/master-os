-- System tab: theme logos, favicon, display currency.
-- Safe to run multiple times.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS logo_light_theme_url text NULL;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS logo_dark_theme_url text NULL;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS favicon_url text NULL;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'GBP';

COMMENT ON COLUMN public.company_settings.logo_light_theme_url IS
  'Sidebar / app chrome logo when theme is light.';

COMMENT ON COLUMN public.company_settings.logo_dark_theme_url IS
  'Sidebar / app chrome logo when theme is dark.';

COMMENT ON COLUMN public.company_settings.favicon_url IS
  'Browser tab icon URL (.ico / .png / .svg).';

COMMENT ON COLUMN public.company_settings.currency IS
  'ISO 4217 display currency for KPIs and UI (GBP, USD, EUR, BRL).';

ALTER TABLE public.company_settings
  DROP CONSTRAINT IF EXISTS company_settings_currency_check;

ALTER TABLE public.company_settings
  ADD CONSTRAINT company_settings_currency_check
  CHECK (currency IN ('GBP', 'USD', 'EUR', 'BRL'));
