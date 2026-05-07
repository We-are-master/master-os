-- Gate draft drawer: routing intake vs full Review & Send / Bids.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS draft_route_completed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.quotes.draft_route_completed IS
  'When false on draft, show intake-only drawer (route to partner bidding vs manual modal). Hide customer proposal until true.';

-- Anything not in draft no longer uses routing.
UPDATE public.quotes SET draft_route_completed = true WHERE status <> 'draft';

-- Drafts that clearly already progressed (priced, partner path, invites) skip intake.
UPDATE public.quotes
SET draft_route_completed = true
WHERE status = 'draft'
  AND (
    COALESCE(total_value, 0) <> 0
    OR COALESCE(cost, 0) <> 0
    OR COALESCE(partner_quotes_count, 0) > 0
    OR quote_type = 'partner'
  );
