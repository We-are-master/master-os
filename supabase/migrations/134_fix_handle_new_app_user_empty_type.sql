-- =============================================================================
-- Migration 134: fix handle_new_app_user — treat empty user_type as external_partner
-- =============================================================================
--
-- Bug: migration 132 gate'd the trigger on user_type = 'external_partner' ONLY.
-- But the mobile app's signUp flow sends metadata { full_name: "..." } without
-- a user_type field. The trigger saw user_type = '' and skipped the insert,
-- leaving new partners without a public.users row. Result: partners stuck on
-- splash because fetchUserProfile returns null.
--
-- Fix: also accept empty string and NULL as "this is a mobile app signup".
-- The explicit gate for 'account_portal' (portal users) still works because
-- the invite route always sets user_type='account_portal' in metadata.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_app_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_type text;
BEGIN
  v_user_type := coalesce(NEW.raw_user_meta_data->>'user_type', '');

  -- Gate: only skip for KNOWN non-app user types that have their own triggers.
  -- Empty string = mobile app signup (no user_type in metadata) → treat as external_partner.
  -- 'external_partner' = explicit mobile app signup → create public.users row.
  -- 'account_portal' = corporate portal → handle_new_account_portal_user handles it.
  -- Anything else (empty or unknown) → default to creating the public.users row
  -- to match the original migration 124 behaviour.
  IF v_user_type = 'account_portal' THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.users (id, email, full_name, user_type, "userActive")
    VALUES (
      NEW.id,
      COALESCE(NEW.email, ''),
      COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email,''), '@', 1), 'User'),
      COALESCE(NULLIF(v_user_type, ''), 'external_partner'),
      false
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_app_user insert failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_app_user() IS
  'Auto-creates public.users row for mobile app signups. Skips only when user_type=account_portal (those go to account_portal_users). Empty or missing user_type defaults to external_partner to match the mobile app flow.';

-- =============================================================================
-- BACKFILL: fix partners who signed up after migration 132 was applied
-- and don't have a public.users row because the old gate skipped them.
-- =============================================================================
-- Find auth.users that have NO row in public.users AND NO row in
-- account_portal_users AND NO row in profiles. These are the orphaned
-- mobile app signups. Create their public.users row now.
INSERT INTO public.users (id, email, full_name, user_type, "userActive")
SELECT
  au.id,
  COALESCE(au.email, ''),
  COALESCE(au.raw_user_meta_data->>'full_name', split_part(COALESCE(au.email,''), '@', 1), 'User'),
  'external_partner',
  false
FROM auth.users au
WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = au.id)
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = au.id)
  AND NOT EXISTS (SELECT 1 FROM public.account_portal_users apu WHERE apu.id = au.id)
ON CONFLICT (id) DO NOTHING;
