-- Migration 144: add `trades text[]` to partners
-- The get_partners_list_bundle RPC (migration 129) references p.trades but the
-- column was never added via a migration, causing error 42703 (undefined_column)
-- when loading the partner picker on any job.

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS trades text[] DEFAULT NULL;

-- Back-fill: initialise trades from the existing single `trade` value so
-- existing rows are consistent with the new multi-trade model.
UPDATE public.partners
SET    trades = ARRAY[trade]
WHERE  trade IS NOT NULL
  AND  trades IS NULL;
