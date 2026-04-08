-- Migration 124: App users table + trigger + RLS
-- Pattern: trigger creates the row on auth.signUp (SECURITY DEFINER, no RLS issues).
-- App then UPDATEs the row with extra fields once authenticated (has bearer token).
-- No INSERT policy needed — the trigger handles it server-side.

-- =============================================
-- 1. TABLE (idempotent)
-- =============================================
CREATE TABLE IF NOT EXISTS public.users (
  id                   uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                text        NOT NULL DEFAULT '',
  full_name            text        NOT NULL DEFAULT '',
  phone                text,
  avatar_url           text,
  user_type            text        NOT NULL DEFAULT 'external_partner',
  "userActive"         boolean     NOT NULL DEFAULT false,
  "fcmToken"           text,
  onboarding_completed boolean     DEFAULT false,
  logo_url             text,
  company_name         text,
  logo_configured      boolean     DEFAULT false,
  work_type            text,
  service_type         text,
  work_area            text,
  utr                  text,
  public_liability_url  text,
  proof_of_address_url  text,
  right_to_work_url     text,
  website              text,
  services_provided    text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 2. TRIGGER: auto-create users row on auth signup
-- App calls supabase.auth.signUp() → trigger fires → row created server-side.
-- No client INSERT needed, no RLS bypass required.
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_app_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, user_type, "userActive")
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email,''), '@', 1), 'User'),
    COALESCE(NEW.raw_user_meta_data->>'user_type', 'external_partner'),
    false  -- inactive until documents reviewed and approved
  )
  ON CONFLICT (id) DO NOTHING;  -- idempotent: don't overwrite if row already exists
  RETURN NEW;
END;
$$;

-- Drop and recreate trigger (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created_app ON auth.users;
CREATE TRIGGER on_auth_user_created_app
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_app_user();

-- =============================================
-- 3. RLS POLICIES
-- No INSERT policy needed — trigger handles creation.
-- App only needs SELECT (to read profile) and UPDATE (to add docs/info).
-- =============================================

DROP POLICY IF EXISTS "Users can view own profile"          ON public.users;
DROP POLICY IF EXISTS "Authenticated can view all app users" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile"        ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile"        ON public.users;

-- User reads their own profile
CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- OS operators can see all profiles (partner management in master-os)
CREATE POLICY "Authenticated can view all app users"
  ON public.users FOR SELECT TO authenticated
  USING (true);

-- User updates their own profile (add documents, company info, etc.)
CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- =============================================
-- 4. GRANT
-- =============================================
GRANT SELECT, UPDATE ON public.users TO authenticated;

COMMENT ON TABLE public.users IS 'Partner app user profiles; row created by trigger on auth.signUp, updated by app after authentication';
COMMENT ON FUNCTION public.handle_new_app_user() IS 'Auto-creates public.users row on auth signup; mirrors handle_new_user() pattern for profiles';
