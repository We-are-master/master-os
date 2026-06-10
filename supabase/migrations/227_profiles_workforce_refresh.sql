-- Force workforce profile refresh on deploy: invalidate old sessions and gate dashboard
-- until linked users complete the onboarding wizard again.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS workforce_refresh_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS session_valid_after timestamptz;

COMMENT ON COLUMN public.profiles.workforce_refresh_required IS
  'When true, dashboard redirects the user to the workforce onboarding wizard on login.';
COMMENT ON COLUMN public.profiles.session_valid_after IS
  'Sessions from logins before this timestamp are invalidated (force re-login).';

ALTER TABLE public.workforce_onboarding_requests
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'invite'
    CHECK (purpose IN ('invite', 'profile_refresh'));

COMMENT ON COLUMN public.workforce_onboarding_requests.purpose IS
  'invite = new hire email link; profile_refresh = mandatory re-confirmation after deploy.';

-- ONE-TIME cutover: only dashboard users linked to a workforce record
UPDATE public.profiles p
SET
  workforce_refresh_required = true,
  session_valid_after = NOW(),
  updated_at = NOW()
WHERE p.id IN (
  SELECT profile_id
  FROM public.payroll_internal_costs
  WHERE profile_id IS NOT NULL
);
