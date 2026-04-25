-- Expected job duration captured at quote creation (number + unit).

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS duration_value numeric,
  ADD COLUMN IF NOT EXISTS duration_unit text;

ALTER TABLE public.quotes
  DROP CONSTRAINT IF EXISTS quotes_duration_unit_check;

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_duration_unit_check
  CHECK (
    duration_unit IS NULL
    OR duration_unit IN ('day', 'week', 'month')
  );

ALTER TABLE public.quotes
  DROP CONSTRAINT IF EXISTS quotes_duration_value_coherent;

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_duration_value_coherent
  CHECK (
    (duration_value IS NULL AND duration_unit IS NULL)
    OR (
      duration_value IS NOT NULL
      AND duration_unit IS NOT NULL
      AND duration_value > 0
    )
  );

COMMENT ON COLUMN public.quotes.duration_value IS 'Expected job duration: count of units (e.g. 2 for "2 weeks").';
COMMENT ON COLUMN public.quotes.duration_unit IS 'Unit for duration_value: day, week, or month.';
