-- Office operational flow: start/final report payloads, review flags, resilient timer (seconds persisted).

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS start_report jsonb,
  ADD COLUMN IF NOT EXISTS start_report_submitted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS start_report_skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS final_report jsonb,
  ADD COLUMN IF NOT EXISTS final_report_submitted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS final_report_skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS timer_elapsed_seconds numeric NOT NULL DEFAULT 0 CHECK (timer_elapsed_seconds >= 0),
  ADD COLUMN IF NOT EXISTS timer_last_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS timer_is_running boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_send_method text CHECK (review_send_method IS NULL OR review_send_method IN ('email', 'manual')),
  ADD COLUMN IF NOT EXISTS internal_report_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS internal_invoice_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS operational_checklist jsonb;

COMMENT ON COLUMN public.jobs.timer_elapsed_seconds IS 'Accumulated on-site seconds when timer stopped; never decremented by UI';
COMMENT ON COLUMN public.jobs.timer_last_started_at IS 'Wall time when current running segment started (resume/start)';
COMMENT ON COLUMN public.jobs.timer_is_running IS 'Office timer running while In Progress';
