-- Partner account_type + wizard completion tracking
--
-- Two new columns on `partners`:
--
--   `wizard_completed_at` — timestamp captured when the partner finishes the
--     Trade Portal `/get-started` wizard (last step signs the agreements).
--     The portal uses this to stop showing the in-portal onboarding modal a
--     second time, and the Master OS uses it as a hard signal that the row
--     belongs in the "Ready" review queue regardless of doc heuristics.
--
--   `account_type` — 'subscription' | 'free' | null. The Master OS admin
--     picks this at the moment of activation from the Ready tab. Downstream
--     billing / invoicing logic reads this to decide whether the partner
--     goes through the Stripe subscription cycle or the ops-managed free
--     tier.

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS wizard_completed_at timestamptz;

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS account_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partners_account_type_check'
  ) THEN
    ALTER TABLE public.partners
      ADD CONSTRAINT partners_account_type_check
      CHECK (account_type IS NULL OR account_type IN ('subscription', 'free'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_partners_wizard_completed_at
  ON public.partners (wizard_completed_at)
  WHERE wizard_completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_partners_account_type
  ON public.partners (account_type)
  WHERE account_type IS NOT NULL;
