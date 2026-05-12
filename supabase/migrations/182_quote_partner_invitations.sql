-- Migration 182: Track which partners were invited to bid on a quote
--
-- Previously the system only stored a count (quotes.partner_quotes_count),
-- which made it impossible to list "who was invited" so the office could
-- copy each partner's unique bid link. This adds the join table the
-- partner-invite-email flow writes to, and the dashboard reads back when
-- rendering the Bids tab.

CREATE TABLE IF NOT EXISTS public.quote_partner_invitations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        uuid        NOT NULL REFERENCES public.quotes(id)   ON DELETE CASCADE,
  partner_id      uuid        NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  invited_at      timestamptz NOT NULL DEFAULT now(),
  invited_by      uuid        REFERENCES public.profiles(id),
  /** Channel(s) used at the latest invite — email and/or push. Comma-separated. */
  last_channel    text,
  /** Updated when we re-send the same partner an invite — handy for "Re-send" UX. */
  last_invited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_quote_partner_invitations_quote_id
  ON public.quote_partner_invitations (quote_id);

ALTER TABLE public.quote_partner_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quote_partner_invitations_staff_all" ON public.quote_partner_invitations;
CREATE POLICY "quote_partner_invitations_staff_all"
  ON public.quote_partner_invitations FOR ALL TO authenticated
  USING (public.is_internal_staff())
  WITH CHECK (public.is_internal_staff());

COMMENT ON TABLE public.quote_partner_invitations IS
  'Per-partner record of bid invitations sent for a quote. One row per (quote_id, partner_id); upserted on each re-invite. Powers the Bids tab partner list with copy-link UX.';
