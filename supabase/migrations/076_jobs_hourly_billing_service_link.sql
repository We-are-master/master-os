-- Jobs: link to service catalog + snapshot hourly rates and billed hours.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS catalog_service_id uuid REFERENCES public.service_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hourly_client_rate numeric,
  ADD COLUMN IF NOT EXISTS hourly_partner_rate numeric,
  ADD COLUMN IF NOT EXISTS billed_hours numeric;

COMMENT ON COLUMN public.jobs.catalog_service_id IS 'Selected Services call-out template for this job (optional).';
COMMENT ON COLUMN public.jobs.hourly_client_rate IS 'Snapshot client hourly rate used for hourly billing.';
COMMENT ON COLUMN public.jobs.hourly_partner_rate IS 'Snapshot partner hourly rate used for hourly billing.';
COMMENT ON COLUMN public.jobs.billed_hours IS 'Computed hours from elapsed timer (min 1h, then 30-minute increments).';

CREATE INDEX IF NOT EXISTS idx_jobs_catalog_service_id ON public.jobs(catalog_service_id);
