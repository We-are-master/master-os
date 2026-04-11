-- =============================================================================
-- Migration 135: Outreach — internal bulk email tool for partners + externals
-- =============================================================================
--
-- Provides three tables that power the /outreach page:
--   outreach_templates             — reusable subject+body models with categories
--   outreach_campaigns             — one row per send (manual/staff composed)
--   outreach_campaign_recipients   — per-recipient row for per-email tracking
--
-- All tables use the same permissive authenticated-only RLS as tickets (migration
-- 133): app-layer admin check gates access. Service role bypasses.
-- =============================================================================

-- =============================================
-- 1. TABLE: outreach_templates
-- =============================================
CREATE TABLE IF NOT EXISTS public.outreach_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  category    text        CHECK (category IN ('onboarding', 'follow_up', 'reactivation', 'announcement', 'custom')),
  subject     text        NOT NULL,
  body_html   text        NOT NULL,
  variables   text[]      NOT NULL DEFAULT '{}',
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_templates_category
  ON public.outreach_templates (category);
CREATE INDEX IF NOT EXISTS idx_outreach_templates_updated
  ON public.outreach_templates (updated_at DESC);

ALTER TABLE public.outreach_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read outreach_templates" ON public.outreach_templates;
CREATE POLICY "Authenticated read outreach_templates"
  ON public.outreach_templates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert outreach_templates" ON public.outreach_templates;
CREATE POLICY "Authenticated insert outreach_templates"
  ON public.outreach_templates FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated update outreach_templates" ON public.outreach_templates;
CREATE POLICY "Authenticated update outreach_templates"
  ON public.outreach_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated delete outreach_templates" ON public.outreach_templates;
CREATE POLICY "Authenticated delete outreach_templates"
  ON public.outreach_templates FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach_templates TO authenticated;

COMMENT ON TABLE public.outreach_templates IS
  'Reusable email templates for the /outreach bulk email tool. Editable via UI.';

-- =============================================
-- 2. TABLE: outreach_campaigns
-- =============================================
CREATE TABLE IF NOT EXISTS public.outreach_campaigns (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id       uuid        REFERENCES public.outreach_templates(id) ON DELETE SET NULL,
  subject           text        NOT NULL,
  body_html         text        NOT NULL,
  sent_by           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_by_name      text,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  recipient_count   integer     NOT NULL DEFAULT 0,
  delivered_count   integer     NOT NULL DEFAULT 0,
  opened_count      integer     NOT NULL DEFAULT 0,
  failed_count      integer     NOT NULL DEFAULT 0,
  status            text        NOT NULL DEFAULT 'sent'
                    CHECK (status IN ('draft', 'sending', 'sent', 'partial', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_sent_at
  ON public.outreach_campaigns (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_sent_by
  ON public.outreach_campaigns (sent_by);

ALTER TABLE public.outreach_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read outreach_campaigns" ON public.outreach_campaigns;
CREATE POLICY "Authenticated read outreach_campaigns"
  ON public.outreach_campaigns FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert outreach_campaigns" ON public.outreach_campaigns;
CREATE POLICY "Authenticated insert outreach_campaigns"
  ON public.outreach_campaigns FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated update outreach_campaigns" ON public.outreach_campaigns;
CREATE POLICY "Authenticated update outreach_campaigns"
  ON public.outreach_campaigns FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.outreach_campaigns TO authenticated;

COMMENT ON TABLE public.outreach_campaigns IS
  'One row per bulk email send. Snapshot of subject+body after variable rendering. Source of truth for /outreach history.';

-- =============================================
-- 3. TABLE: outreach_campaign_recipients
-- =============================================
CREATE TABLE IF NOT EXISTS public.outreach_campaign_recipients (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid        NOT NULL REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
  partner_id        uuid        REFERENCES public.partners(id) ON DELETE SET NULL,
  email             text        NOT NULL,
  name              text,
  resend_message_id text,
  status            text        NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'sent', 'delivered', 'opened', 'bounced', 'failed')),
  error_message     text,
  delivered_at      timestamptz,
  opened_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_recipients_campaign
  ON public.outreach_campaign_recipients (campaign_id);
CREATE INDEX IF NOT EXISTS idx_outreach_recipients_partner
  ON public.outreach_campaign_recipients (partner_id)
  WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outreach_recipients_message
  ON public.outreach_campaign_recipients (resend_message_id)
  WHERE resend_message_id IS NOT NULL;

ALTER TABLE public.outreach_campaign_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read outreach_recipients" ON public.outreach_campaign_recipients;
CREATE POLICY "Authenticated read outreach_recipients"
  ON public.outreach_campaign_recipients FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert outreach_recipients" ON public.outreach_campaign_recipients;
CREATE POLICY "Authenticated insert outreach_recipients"
  ON public.outreach_campaign_recipients FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated update outreach_recipients" ON public.outreach_campaign_recipients;
CREATE POLICY "Authenticated update outreach_recipients"
  ON public.outreach_campaign_recipients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.outreach_campaign_recipients TO authenticated;

COMMENT ON TABLE public.outreach_campaign_recipients IS
  'One row per destinatary of an outreach_campaigns send. Stores Resend message id to support webhook tracking (delivered/opened/bounced) in a later phase.';

-- =============================================
-- 4. Trigger: auto-update outreach_templates.updated_at
-- =============================================
CREATE OR REPLACE FUNCTION public.outreach_templates_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outreach_templates_touch ON public.outreach_templates;
CREATE TRIGGER trg_outreach_templates_touch
  BEFORE UPDATE ON public.outreach_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.outreach_templates_touch_updated_at();
