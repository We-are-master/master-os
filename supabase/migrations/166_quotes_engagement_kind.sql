-- One-off vs recurring intent on quotes (pairs with duration; aligns with jobs repeat UX).

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS engagement_kind text NOT NULL DEFAULT 'one_off';

ALTER TABLE public.quotes
  DROP CONSTRAINT IF EXISTS quotes_engagement_kind_check;

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_engagement_kind_check
  CHECK (engagement_kind IN ('one_off', 'recurring'));

COMMENT ON COLUMN public.quotes.engagement_kind IS 'Whether quoted work is a single engagement (one_off) or recurring/repeating over time (recurring).';
