-- Bid-approval + partner-acceptance flow.
--
--   quotes.zendesk_side_conversation_id  — opened at bid approval and copied
--                                          to jobs.zendesk_side_conversation_id
--                                          when the quote converts to a job
--                                          (same partner email thread carries
--                                          across the quote→job boundary).
--
--   jobs.partner_confirmed_at            — set when the partner clicks
--                                          "Accept" on the confirmation-
--                                          request email; the OS flips status
--                                          to scheduled and sends the booked
--                                          email after this is stamped.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS zendesk_side_conversation_id text;

CREATE INDEX IF NOT EXISTS idx_quotes_zendesk_side_conversation_id
  ON public.quotes (zendesk_side_conversation_id)
  WHERE zendesk_side_conversation_id IS NOT NULL;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS partner_confirmed_at timestamptz;

COMMENT ON COLUMN public.jobs.partner_confirmed_at IS
  'Set when the assigned partner accepts the job via the tokenised email link.';
