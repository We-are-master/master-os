-- Optional external URL (shared drive, Notion, etc.) for office reference — opens in new tab from job UI.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS report_link text;

COMMENT ON COLUMN public.jobs.report_link IS
  'Optional external report / document link (office); not shown to clients by default.';
