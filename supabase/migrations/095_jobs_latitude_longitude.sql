-- Geocoded from property_address (OpenCage) for partner app map / directions.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS latitude double precision;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS longitude double precision;

COMMENT ON COLUMN public.jobs.latitude IS 'WGS84 latitude from geocoding property_address (dashboard OpenCage).';
COMMENT ON COLUMN public.jobs.longitude IS 'WGS84 longitude from geocoding property_address (dashboard OpenCage).';
