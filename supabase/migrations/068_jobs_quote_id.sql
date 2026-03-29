-- Link jobs created from quotes (insert sends quote_id from app)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_quote_id ON public.jobs (quote_id);
