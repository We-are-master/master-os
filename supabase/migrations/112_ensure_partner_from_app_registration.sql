-- App registration: create a directory partner row linked to the auth user (replaces n8n webhook).
-- Idempotent: safe to call multiple times; returns existing partners.id when already linked.

CREATE OR REPLACE FUNCTION public.ensure_partner_from_app_registration()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  u RECORD;
  existing_id uuid;
  trade_val text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT
    id,
    email,
    full_name,
    company_name,
    phone,
    user_type,
    utr
  INTO u
  FROM public.users
  WHERE id = uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF u.user_type IS DISTINCT FROM 'external_partner' THEN
    RETURN NULL;
  END IF;

  SELECT p.id INTO existing_id
  FROM public.partners p
  WHERE p.auth_user_id = uid
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  trade_val := 'General';

  INSERT INTO public.partners (
    company_name,
    contact_name,
    email,
    phone,
    trade,
    status,
    location,
    auth_user_id,
    utr,
    verified
  )
  VALUES (
    COALESCE(NULLIF(TRIM(u.company_name), ''), u.full_name, 'Partner'),
    COALESCE(u.full_name, 'Partner'),
    COALESCE(u.email, ''),
    NULLIF(TRIM(COALESCE(u.phone, '')), ''),
    trade_val,
    'onboarding',
    'UK',
    uid,
    NULLIF(TRIM(COALESCE(u.utr, '')), ''),
    false
  )
  RETURNING id INTO existing_id;

  RETURN existing_id;
END;
$$;

COMMENT ON FUNCTION public.ensure_partner_from_app_registration() IS
  'Called from the partner app after signup: creates partners row (status onboarding) linked via auth_user_id.';

REVOKE ALL ON FUNCTION public.ensure_partner_from_app_registration() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_partner_from_app_registration() TO authenticated;
