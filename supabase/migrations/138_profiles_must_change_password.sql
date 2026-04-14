-- =============================================================================
-- Migration 138: profiles.must_change_password + payroll_internal_costs.profile_id
-- =============================================================================
--
-- Supports the Workforce unification:
--   1. profiles.must_change_password — flag set when an admin creates a user
--      with a temporary password. Dashboard forces the user to set a new
--      password before accessing the app; cleared after successful change.
--   2. payroll_internal_costs.profile_id — nullable FK linking a workforce
--      roster row to the matching dashboard login. Allows the Workforce
--      drawer to expose "Dashboard Access" management for each person.
--
-- Non-destructive: both columns are nullable / have safe defaults, so
-- existing rows are unaffected.
-- =============================================================================

-- 1. profiles.must_change_password
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.must_change_password IS
  'True when admin created this user with a temporary password. User is forced to change it on first login.';

CREATE INDEX IF NOT EXISTS idx_profiles_must_change_password
  ON public.profiles (id) WHERE must_change_password = true;

-- 2. payroll_internal_costs.profile_id
ALTER TABLE public.payroll_internal_costs
  ADD COLUMN IF NOT EXISTS profile_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_internal_costs_profile
  ON public.payroll_internal_costs (profile_id) WHERE profile_id IS NOT NULL;

COMMENT ON COLUMN public.payroll_internal_costs.profile_id IS
  'Linked profiles.id when this workforce person has a dashboard login. Nullable — contractors without app access remain linked only by payee_name.';
