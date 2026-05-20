-- Migration 195: partner offer accept/decline response
--
-- When the office assigns a partner to a job, the partner now receives an
-- email (via Zendesk side conversation when the job is linked, direct email
-- otherwise) with Accept / Decline CTAs. The public response endpoint
-- writes the outcome here, and the dashboard can read these columns to
-- show whether the assigned partner has actually confirmed.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS partner_offer_response      text
    CHECK (partner_offer_response IN ('accepted', 'declined') OR partner_offer_response IS NULL),
  ADD COLUMN IF NOT EXISTS partner_offer_responded_at  timestamptz,
  ADD COLUMN IF NOT EXISTS partner_offer_decline_reason text;

COMMENT ON COLUMN public.jobs.partner_offer_response IS
  'How the assigned partner responded to the offer email: ''accepted'' / ''declined'' / null when no response yet. Reset to null whenever partner_id changes.';
COMMENT ON COLUMN public.jobs.partner_offer_responded_at IS
  'When the partner clicked Accept / Decline on the public offer link.';
COMMENT ON COLUMN public.jobs.partner_offer_decline_reason IS
  'Optional free-text reason the partner declined the job.';
