-- Partner geographic coverage (TradesPortal-aligned): radius miles OR included postcodes by city.

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS coverage_mode text,
  ADD COLUMN IF NOT EXISTS service_radius_miles numeric,
  ADD COLUMN IF NOT EXISTS coverage_latitude double precision,
  ADD COLUMN IF NOT EXISTS coverage_longitude double precision,
  ADD COLUMN IF NOT EXISTS coverage_base_postcode text,
  ADD COLUMN IF NOT EXISTS included_postcodes text[],
  ADD COLUMN IF NOT EXISTS coverage_cities text[],
  ADD COLUMN IF NOT EXISTS excluded_postcodes text[],
  ADD COLUMN IF NOT EXISTS job_preferences jsonb,
  ADD COLUMN IF NOT EXISTS availability jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'partners_coverage_mode_check'
      AND conrelid = 'public.partners'::regclass
  ) THEN
    ALTER TABLE public.partners
      ADD CONSTRAINT partners_coverage_mode_check
      CHECK (coverage_mode IS NULL OR coverage_mode IN ('radius', 'postcodes'));
  END IF;
END $$;

COMMENT ON COLUMN public.partners.coverage_mode IS
  'How this partner defines work area: radius from base pin, or explicit included outward postcodes.';
COMMENT ON COLUMN public.partners.service_radius_miles IS
  'When coverage_mode=radius: max distance in miles from coverage_latitude/longitude.';
COMMENT ON COLUMN public.partners.coverage_latitude IS
  'Radius mode: base map pin latitude.';
COMMENT ON COLUMN public.partners.coverage_longitude IS
  'Radius mode: base map pin longitude.';
COMMENT ON COLUMN public.partners.coverage_base_postcode IS
  'Radius mode: display/search postcode for the base pin.';
COMMENT ON COLUMN public.partners.included_postcodes IS
  'Postcodes mode: outward codes (e.g. SW11, E1) this partner accepts work in.';
COMMENT ON COLUMN public.partners.coverage_cities IS
  'Postcodes mode: city ids from OS catalogue (e.g. london).';
COMMENT ON COLUMN public.partners.excluded_postcodes IS
  'Trade Portal: outward prefixes the partner refuses (applied after positive coverage).';

-- Migrate legacy uk_coverage_regions: London-only → postcodes + full London outward list handled in app on read;
-- SQL sets mode and city; included_postcodes backfill runs in app or next partner save.
UPDATE public.partners
SET
  coverage_mode = COALESCE(coverage_mode, 'postcodes'),
  coverage_cities = COALESCE(coverage_cities, ARRAY['london']::text[])
WHERE coverage_mode IS NULL
  AND (
    uk_coverage_regions IS NOT NULL
    AND (
      'London' = ANY (uk_coverage_regions)
      OR location ILIKE '%london%'
    )
  );
