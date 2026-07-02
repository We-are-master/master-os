-- Partner billing readiness + monthly usage counters for plan limits (trade portal).

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS billing_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS usage_period_start date,
  ADD COLUMN IF NOT EXISTS leads_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS jobs_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quotes_used integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.partners.billing_ready IS 'True when a default payment method is saved (SetupIntent) — subscription starts on OS activation.';
COMMENT ON COLUMN public.partners.usage_period_start IS 'Start of current monthly usage window for plan limits (Pro tier).';
COMMENT ON COLUMN public.partners.leads_used IS 'Lead responses in current usage period.';
COMMENT ON COLUMN public.partners.jobs_used IS 'Job accepts in current usage period.';
COMMENT ON COLUMN public.partners.quotes_used IS 'Quote actions in current usage period.';
