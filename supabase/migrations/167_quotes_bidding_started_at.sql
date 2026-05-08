-- When a quote enters Bidding we track SLA start time (8h target to close & send).
-- Automatically set / cleared via trigger so API, UI, Desk, bulk actions stay consistent.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS bidding_started_at TIMESTAMPTZ;

COMMENT ON COLUMN public.quotes.bidding_started_at IS
  'UTC moment the quote entered status bidding — used for ops SLA countdown (send to customer). Cleared when status leaves bidding.';

CREATE OR REPLACE FUNCTION public.quotes_touch_bidding_started_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'bidding'::text THEN
    IF TG_OP = 'INSERT' THEN
      NEW.bidding_started_at := COALESCE(NEW.bidding_started_at, NOW());
    ELSIF OLD.status IS DISTINCT FROM 'bidding'::text THEN
      NEW.bidding_started_at := NOW();
    ELSE
      NEW.bidding_started_at := COALESCE(NEW.bidding_started_at, OLD.bidding_started_at);
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      NEW.bidding_started_at := NULL;
    END IF;
    -- INSERT non-bidding: leave NULL (already unset)
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_bidding_started_at_trg ON public.quotes;

CREATE TRIGGER quotes_bidding_started_at_trg
  BEFORE INSERT OR UPDATE OF status ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.quotes_touch_bidding_started_at();

-- Best-effort for rows already stuck in bidding (before this migration).
UPDATE public.quotes
SET bidding_started_at = COALESCE(updated_at, created_at, NOW())
WHERE status = 'bidding'::text
  AND deleted_at IS NULL
  AND bidding_started_at IS NULL;
