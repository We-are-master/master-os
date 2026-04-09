-- =============================================================================
-- Migration 132: harden handle_new_account_portal_user against signup aborts
-- =============================================================================
--
-- Bug context:
-- The original trigger from migration 131 has a bare `INSERT INTO
-- public.account_portal_users` that, if it fails for ANY reason
-- (table missing because migration 131 wasn't applied yet, FK violation,
-- RLS, anything), bubbles the error up and aborts the auth.users INSERT.
-- The result is the API call sees:
--
--   AuthApiError: Database error saving new user (code: unexpected_failure)
--
-- and no user gets created at all.
--
-- This migration also re-applies the table + trigger creation idempotently
-- so applying ONLY migration 132 (without 131) still leaves the database
-- in a working state. The defensive EXCEPTION block then guarantees the
-- trigger NEVER aborts the parent signup — at worst it's a no-op and the
-- API route's defensive insert (added in the same fix) populates the row.
-- =============================================================================

-- Safety: re-create the table (idempotent) so 132 alone is sufficient.
CREATE TABLE IF NOT EXISTS public.account_portal_users (
  id                 uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id         uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  email              text        NOT NULL,
  full_name          text,
  is_active          boolean     NOT NULL DEFAULT true,
  invited_by         uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_signed_in_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_portal_users_account_id
  ON public.account_portal_users (account_id);
CREATE INDEX IF NOT EXISTS idx_account_portal_users_email
  ON public.account_portal_users (lower(email));

ALTER TABLE public.account_portal_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Portal users read own row"   ON public.account_portal_users;
DROP POLICY IF EXISTS "Portal users update own row" ON public.account_portal_users;
DROP POLICY IF EXISTS "Authenticated read all portal users" ON public.account_portal_users;

CREATE POLICY "Portal users read own row"
  ON public.account_portal_users FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Portal users update own row"
  ON public.account_portal_users FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Authenticated read all portal users"
  ON public.account_portal_users FOR SELECT TO authenticated
  USING (true);

GRANT SELECT, UPDATE, INSERT ON public.account_portal_users TO authenticated;

-- =============================================
-- HARDENED TRIGGER FUNCTION
-- =============================================
-- The full body is wrapped in BEGIN...EXCEPTION WHEN OTHERS so any failure
-- (missing table, FK violation, anything) just no-ops the trigger and
-- returns NEW. The auth.users INSERT will still succeed and the API
-- route's defensive insert path (in /api/admin/account/invite-portal-user)
-- will then create the row directly using the service role client.
CREATE OR REPLACE FUNCTION public.handle_new_account_portal_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_type  text;
  v_account_id uuid;
  v_full_name  text;
  v_invited_by uuid;
BEGIN
  v_user_type := coalesce(NEW.raw_user_meta_data->>'user_type', '');
  IF v_user_type <> 'account_portal' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_account_id := (NEW.raw_user_meta_data->>'account_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_account_id := NULL;
  END;
  IF v_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_full_name := NEW.raw_user_meta_data->>'full_name';

  BEGIN
    v_invited_by := (NEW.raw_user_meta_data->>'invited_by')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_invited_by := NULL;
  END;

  -- Wrap the INSERT in its own exception block so a failure here CANNOT
  -- abort the parent auth.users signup. If this fails the API route will
  -- create the row directly via the service-role client.
  BEGIN
    INSERT INTO public.account_portal_users (id, account_id, email, full_name, invited_by)
    VALUES (
      NEW.id,
      v_account_id,
      coalesce(NEW.email, ''),
      v_full_name,
      v_invited_by
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Swallow the error, log to Postgres logs, return NEW so signup proceeds.
    RAISE WARNING 'handle_new_account_portal_user insert failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_account_portal ON auth.users;
CREATE TRIGGER on_auth_user_created_account_portal
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_account_portal_user();

COMMENT ON FUNCTION public.handle_new_account_portal_user() IS
  'Auto-creates public.account_portal_users row when an auth user is created with user_type=account_portal. Hardened: trigger errors are swallowed so they never abort the parent auth signup.';
