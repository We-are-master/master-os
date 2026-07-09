-- Portal plan-usage tracking columns on partners.
--
-- The Trade Portal plan gate (src/lib/plan-access-gate.ts) selects these to enforce
-- per-plan monthly limits (leads / jobs / quotes). They were referenced in code but
-- never migrated in — so on the self-hosted DB the SELECT errors (42703) and the
-- partner's "Interested" / accept actions fail with a misleading "Partner not found".
--
-- Idempotent — safe to run anytime.

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS usage_period_start date,
  ADD COLUMN IF NOT EXISTS leads_used  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS jobs_used   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quotes_used integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.partners.usage_period_start IS 'First day of the current usage month (YYYY-MM-01); resets the *_used counters when it rolls over.';
COMMENT ON COLUMN public.partners.leads_used  IS 'Leads the partner responded to in the current usage period (plan limit).';
COMMENT ON COLUMN public.partners.jobs_used   IS 'Jobs the partner accepted in the current usage period (plan limit).';
COMMENT ON COLUMN public.partners.quotes_used IS 'Quotes the partner bid on in the current usage period (plan limit).';
