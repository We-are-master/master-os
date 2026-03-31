-- Access flags and pricing linkage for work requests / jobs.
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS in_ccz boolean,
  ADD COLUMN IF NOT EXISTS has_free_parking boolean;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS in_ccz boolean,
  ADD COLUMN IF NOT EXISTS has_free_parking boolean;

COMMENT ON COLUMN public.service_requests.in_ccz IS 'True when address is inside CCZ (used for +£15 surcharge).';
COMMENT ON COLUMN public.service_requests.has_free_parking IS 'True when free parking is available (false adds +£15 surcharge).';
COMMENT ON COLUMN public.jobs.in_ccz IS 'Snapshot from request/job modal. True adds +£15 surcharge.';
COMMENT ON COLUMN public.jobs.has_free_parking IS 'Snapshot from request/job modal. False adds +£15 surcharge.';
