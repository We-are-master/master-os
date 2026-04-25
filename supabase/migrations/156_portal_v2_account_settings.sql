-- =============================================================================
-- Migration 156: account_settings + account_notification_preferences
-- =============================================================================
--
-- Two preference tables that back the portal Settings page. Both
-- depend on the helpers from migration 148 (current_portal_account_id,
-- is_internal_staff). Apply 148 first.
--
-- - account_settings: 1-1 with accounts. Backfilled for every existing
--   account via INSERT ... SELECT at the end.
-- - account_notification_preferences: many-to-one. portal_user_id NULL
--   = account-wide default; specific uuid = override for that user.
--
-- Note: quote_line_items already exists since migration 010 (we only
-- need the policy tightening which is covered in mig 151).
-- Idempotent.
-- =============================================================================

-- =============================================
-- 1. account_settings
-- =============================================
CREATE TABLE IF NOT EXISTS public.account_settings (
  account_id                  uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  legal_name                  text,
  vat_percentage              numeric NOT NULL DEFAULT 20,
  currency                    text    NOT NULL DEFAULT 'GBP',
  default_payment_terms_days  integer NOT NULL DEFAULT 30,
  accent_colour               text,
  logo_url                    text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_settings_select_scoped" ON public.account_settings;
CREATE POLICY "account_settings_select_scoped"
  ON public.account_settings FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR account_id = public.current_portal_account_id()
  );

DROP POLICY IF EXISTS "account_settings_update_scoped" ON public.account_settings;
CREATE POLICY "account_settings_update_scoped"
  ON public.account_settings FOR UPDATE TO authenticated
  USING (
    public.is_internal_staff()
    OR account_id = public.current_portal_account_id()
  )
  WITH CHECK (
    public.is_internal_staff()
    OR account_id = public.current_portal_account_id()
  );

GRANT SELECT, UPDATE ON public.account_settings TO authenticated;

COMMENT ON TABLE public.account_settings IS
  '1-1 settings record per account. Auto-created via trigger when an account is inserted; backfilled for existing rows by mig 156.';

-- Auto-create a settings row for every new account
CREATE OR REPLACE FUNCTION public.handle_new_account_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.account_settings (account_id, legal_name)
  VALUES (NEW.id, NEW.company_name)
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_account_created_seed_settings ON public.accounts;
CREATE TRIGGER on_account_created_seed_settings
  AFTER INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_account_settings();

-- Backfill rows for all existing accounts that don't have one yet.
INSERT INTO public.account_settings (account_id, legal_name)
SELECT a.id, a.company_name
FROM public.accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM public.account_settings s WHERE s.account_id = a.id
);

-- =============================================
-- 2. account_notification_preferences
-- =============================================
CREATE TABLE IF NOT EXISTS public.account_notification_preferences (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  portal_user_id    uuid REFERENCES public.account_portal_users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  channel           text NOT NULL,
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_notification_preferences_type_check'
  ) THEN
    ALTER TABLE public.account_notification_preferences
      ADD CONSTRAINT account_notification_preferences_type_check
      CHECK (notification_type IN (
        'quote_submitted','compliance_due','job_overdue',
        'invoice_issued','weekly_digest','sla_breach',
        'finance_alert','tenant_message','ticket_reply'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_notification_preferences_channel_check'
  ) THEN
    ALTER TABLE public.account_notification_preferences
      ADD CONSTRAINT account_notification_preferences_channel_check
      CHECK (channel IN ('email','push','sms','in_app'));
  END IF;
END $$;

-- Each (account, user, type, channel) tuple is unique.
-- portal_user_id NULL means account-wide default.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_prefs_user_scoped
  ON public.account_notification_preferences (account_id, portal_user_id, notification_type, channel)
  WHERE portal_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_prefs_account_default
  ON public.account_notification_preferences (account_id, notification_type, channel)
  WHERE portal_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_notification_prefs_account_user
  ON public.account_notification_preferences (account_id, portal_user_id);

ALTER TABLE public.account_notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif_prefs_select_scoped" ON public.account_notification_preferences;
CREATE POLICY "notif_prefs_select_scoped"
  ON public.account_notification_preferences FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR account_id = public.current_portal_account_id()
  );

DROP POLICY IF EXISTS "notif_prefs_insert_scoped" ON public.account_notification_preferences;
CREATE POLICY "notif_prefs_insert_scoped"
  ON public.account_notification_preferences FOR INSERT TO authenticated
  WITH CHECK (
    public.is_internal_staff()
    OR (
      account_id = public.current_portal_account_id()
      AND (portal_user_id IS NULL OR portal_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "notif_prefs_update_scoped" ON public.account_notification_preferences;
CREATE POLICY "notif_prefs_update_scoped"
  ON public.account_notification_preferences FOR UPDATE TO authenticated
  USING (
    public.is_internal_staff()
    OR (
      account_id = public.current_portal_account_id()
      AND (portal_user_id IS NULL OR portal_user_id = auth.uid())
    )
  )
  WITH CHECK (
    public.is_internal_staff()
    OR (
      account_id = public.current_portal_account_id()
      AND (portal_user_id IS NULL OR portal_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "notif_prefs_delete_scoped" ON public.account_notification_preferences;
CREATE POLICY "notif_prefs_delete_scoped"
  ON public.account_notification_preferences FOR DELETE TO authenticated
  USING (
    public.is_internal_staff()
    OR (
      account_id = public.current_portal_account_id()
      AND (portal_user_id IS NULL OR portal_user_id = auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_notification_preferences TO authenticated;

COMMENT ON TABLE public.account_notification_preferences IS
  'Notification toggles per account-user-type-channel. portal_user_id NULL = account-wide default; specific uuid = personal override.';
