-- Idempotency guard: only one "Job booked" Zendesk side conversation per job.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS partner_booked_email_sent_at timestamptz;

COMMENT ON COLUMN public.jobs.partner_booked_email_sent_at IS
  'Set when the partner Job booked confirmation email is sent (Zendesk side conv or equivalent). Prevents duplicate sends on portal+email accept race.';
