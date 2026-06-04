-- Migration 212: bid auto-selection strategy on company_settings.
--
-- Drives which partner bid the OS auto-picks to fill the customer proposal on a
-- bidding quote. 'best_value' balances price + partner rating (falls back to
-- cheapest when ratings are absent); 'soonest_start' picks the earliest start
-- date; 'cheapest' is the legacy lowest-price rule (kept valid as the internal
-- fallback even though the UI exposes only best_value / soonest_start).

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS bid_auto_select_strategy text NOT NULL DEFAULT 'best_value';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_settings_bid_auto_select_strategy_check'
  ) THEN
    ALTER TABLE public.company_settings
      ADD CONSTRAINT company_settings_bid_auto_select_strategy_check
      CHECK (bid_auto_select_strategy IN ('best_value', 'soonest_start', 'cheapest'));
  END IF;
END $$;

COMMENT ON COLUMN public.company_settings.bid_auto_select_strategy IS
  'Auto-pick strategy for partner bids driving the customer proposal: best_value | soonest_start | cheapest.';
