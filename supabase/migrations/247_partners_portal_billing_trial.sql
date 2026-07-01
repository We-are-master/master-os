-- Migration 247: Fixfy Pro (trade portal) partner columns — billing/trial + legal + profile.
--
-- The trade portal (master-trade-portal) signup, onboarding and billing read/write these
-- columns on public.partners, but no earlier migration ever created them. Without them:
--   - POST /api/auth/signup fails on the partners INSERT (writes subscription_status/plan/
--     trial_ends_at) → the UI shows "Couldn't set up your trade profile. Try again."
--   - partner-auth reads them best-effort, so sign-in still works and masks the gap
--   - limited-company onboarding (crn / vat_number) and the required-docs gate break
--
-- All additive, nullable and idempotent (IF NOT EXISTS) — safe to run on any environment,
-- including ones where some columns were already added by hand.

ALTER TABLE public.partners
  -- billing / trial (Stripe phase)
  ADD COLUMN IF NOT EXISTS plan                 text,
  ADD COLUMN IF NOT EXISTS subscription_status  text,
  ADD COLUMN IF NOT EXISTS trial_ends_at        timestamptz,
  ADD COLUMN IF NOT EXISTS billing_ready        boolean,
  -- limited-company legal details
  ADD COLUMN IF NOT EXISTS crn                  text,
  ADD COLUMN IF NOT EXISTS vat_number           text,
  -- portal profile
  ADD COLUMN IF NOT EXISTS bio                  text,
  ADD COLUMN IF NOT EXISTS years_experience     integer,
  ADD COLUMN IF NOT EXISTS service_radius_miles integer,
  ADD COLUMN IF NOT EXISTS excluded_postcodes   text[];

COMMENT ON COLUMN public.partners.plan IS 'Portal subscription plan: starter | pro | vip.';
COMMENT ON COLUMN public.partners.subscription_status IS 'Portal billing state: trialing | active | past_due | canceled …';
COMMENT ON COLUMN public.partners.trial_ends_at IS 'End of the free trial granted at portal signup.';
COMMENT ON COLUMN public.partners.billing_ready IS 'True once a payment method / subscription is set up in the portal.';
COMMENT ON COLUMN public.partners.crn IS 'Companies House registration number (limited companies).';
COMMENT ON COLUMN public.partners.vat_number IS 'VAT number (VAT-registered limited companies).';
COMMENT ON COLUMN public.partners.service_radius_miles IS 'How far the partner will travel for work, in miles.';
COMMENT ON COLUMN public.partners.excluded_postcodes IS 'Postcode prefixes the partner will not cover.';
