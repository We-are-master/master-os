-- =============================================================================
-- Migration 131: Account Portal — DB foundation
-- =============================================================================
--
-- Adds the third user type: account_portal users.
-- Internal staff   → public.profiles            (handle_new_user)
-- Mobile partners  → public.users               (handle_new_app_user)
-- Account portal   → public.account_portal_users (handle_new_account_portal_user) ← NEW
--
-- Each portal user is bound to exactly one accounts.id and only sees data
-- scoped to that account. Multiple portal users per account are allowed.
--
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION, etc.). Safe to re-run. Purely additive — does not alter any
-- existing table.
-- =============================================================================

-- =============================================
-- 1. TABLE: account_portal_users
-- =============================================
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

COMMENT ON TABLE public.account_portal_users IS
  'Corporate-account portal users. Each row links an auth.users id to one accounts row. Multiple portal users per account allowed.';

-- =============================================
-- 2. RLS — only allow each user to read/update their own row
-- =============================================
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

-- Internal staff (dashboard) can list portal users so the Accounts page can
-- show "X portal users invited". Read-only — they don't update through this.
CREATE POLICY "Authenticated read all portal users"
  ON public.account_portal_users FOR SELECT TO authenticated
  USING (true);

GRANT SELECT, UPDATE ON public.account_portal_users TO authenticated;

-- =============================================
-- 3. handle_new_user — also skip account_portal
-- =============================================
-- Mirrors the migration 130 fix: gate the profiles insert on user_type so
-- we don't create duplicate rows for portal users.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_type text;
BEGIN
  v_user_type := coalesce(NEW.raw_user_meta_data->>'user_type', '');

  -- Skip the profiles insert for both non-staff user types — each has its
  -- own dedicated trigger and table.
  IF v_user_type = 'external_partner' OR v_user_type = 'account_portal' THEN
    RETURN NEW;
  END IF;

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
  'Auto-creates public.profiles row on internal-staff auth signup. Skips external_partner (→ public.users) and account_portal (→ public.account_portal_users).';

-- =============================================
-- 4. handle_new_account_portal_user — auto-create portal user row
-- =============================================
-- Reads account_id and full_name from raw_user_meta_data and inserts into
-- public.account_portal_users. Mirrors handle_new_app_user from migration 124.
--
-- The /api/admin/account/invite-portal-user route (Phase 7) sets:
--   user_metadata = {
--     user_type:  'account_portal',
--     account_id: '<uuid>',
--     full_name:  '<name>',
--     invited_by: '<staff profile uuid>'
--   }
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

  -- account_id is required — the invite route always sets it. If missing,
  -- silently skip rather than aborting the auth signup itself.
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

  INSERT INTO public.account_portal_users (id, account_id, email, full_name, invited_by)
  VALUES (
    NEW.id,
    v_account_id,
    coalesce(NEW.email, ''),
    v_full_name,
    v_invited_by
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_account_portal_user() IS
  'Auto-creates public.account_portal_users row when an auth user is created with user_type=account_portal in raw_user_meta_data.';

DROP TRIGGER IF EXISTS on_auth_user_created_account_portal ON auth.users;
CREATE TRIGGER on_auth_user_created_account_portal
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_account_portal_user();
