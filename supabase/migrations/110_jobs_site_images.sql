-- Site / reference photos on jobs (client request → quote → job); same storage pattern as quotes.images (quote-invite-images bucket public URLs).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.jobs.images IS 'JSON array of public storage URLs for site reference photos (from request/quote and/or office upload)';
