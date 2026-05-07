-- Persist a best-effort SLA anchor for legacy open bidding rows (column was null).
-- Safe: trigger runs only on UPDATE OF status, not when only bidding_started_at changes.

UPDATE public.quotes
SET bidding_started_at = COALESCE(updated_at, created_at)
WHERE status = 'bidding'::text
  AND deleted_at IS NULL
  AND bidding_started_at IS NULL;
