-- On-hold resolution submission: the partner's reply to a complaint, sent from
-- the "Resolve this job" link in the on-hold email (notes + photos). Stored on
-- the job for the office to review; also posted as an internal note on the
-- linked Zendesk ticket. Submitting does NOT resume the job — the office
-- reviews and resumes manually.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS on_hold_submission    jsonb,
  ADD COLUMN IF NOT EXISTS on_hold_submission_at timestamptz;

COMMENT ON COLUMN public.jobs.on_hold_submission IS
  'Partner''s on-hold resolution reply: { notes, photos: text[] (job-photos bucket paths), partner_id, submitted_at }.';
COMMENT ON COLUMN public.jobs.on_hold_submission_at IS
  'When the partner submitted their on-hold resolution (notes + photos).';
