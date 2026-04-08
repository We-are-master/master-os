-- =============================================================================
-- Migration 126: handle_new_user — skip external_partner signups
-- =============================================================================
--
-- Bug fix:
-- The original `handle_new_user` trigger from migration 001 unconditionally
-- inserts a row into public.profiles whenever a new auth user is created.
-- This was correct when the only users were internal staff (Master OS team).
--
-- Migration 124 added public.users (the app-side user profile table) and a
-- separate trigger `handle_new_app_user` that creates a row there for partner
-- app users. The result was that **every partner who signed up via /join**
-- got two rows: one in public.profiles AND one in public.users.
--
-- Fix: gate the insert in handle_new_user on the user_type metadata. When the
-- /join/register endpoint creates the auth user, it sets
--   user_metadata = { user_type: "external_partner", full_name: "..." }
-- so the trigger can detect and skip them.
--
-- Internal staff signups (admin/manager/operator) do NOT pass user_type, so
-- the existing behaviour is preserved for them.
--
-- This migration is idempotent (CREATE OR REPLACE FUNCTION).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_type text;
BEGIN
  -- Pull user_type out of raw_user_meta_data (set by /api/join/register)
  v_user_type := coalesce(NEW.raw_user_meta_data->>'user_type', '');

  -- External partners get their profile row from `handle_new_app_user`
  -- (migration 124) which writes to public.users. Skip the internal-staff
  -- profiles row entirely so we don't create duplicates.
  IF v_user_type = 'external_partner' THEN
    RETURN NEW;
  END IF;

  -- Internal staff: original behaviour — create the profiles row.
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'operator'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Auto-creates public.profiles row on internal-staff auth signup. Skips external_partner accounts (those use public.users via handle_new_app_user from migration 124).';

-- =============================================================================
-- CLEAN UP existing duplicates
-- =============================================================================
-- Any partner who signed up via /join before this fix has both a profiles
-- row AND a users row. Delete the orphaned profiles rows so the team page
-- doesn't list them as internal staff.
--
-- Safe filter: only delete profiles rows whose id is also present in
-- public.users with user_type = 'external_partner'. We never touch internal
-- staff profiles.

DELETE FROM public.profiles p
WHERE EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = p.id
    AND u.user_type = 'external_partner'
);
