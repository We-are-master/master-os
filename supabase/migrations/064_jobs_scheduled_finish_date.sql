-- Civil finish date for calendar span (no time). Arrival window stays in scheduled_start_at / scheduled_end_at.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS scheduled_finish_date date;
