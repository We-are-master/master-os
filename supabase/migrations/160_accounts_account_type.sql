-- =============================================================================
-- Migration 160: account_type on accounts
-- =============================================================================
--
-- Drives the portal v2 UI's "business type" branching (different
-- labels, different module visibility) and the staff dashboard's
-- account-type filters. Four valid values match the four account
-- profiles documented in master-portal/src/lib/account-type.ts:
--
--   real_estate  — property managers / lettings agencies
--   franchise    — multi-location franchise operations
--   service      — service platforms re-selling Fixfy under their brand
--   enterprise   — single or multi-site direct customers
--
-- Default 'enterprise' for any existing account that doesn't have a
-- type set yet (most generic bucket; staff can re-classify later).
-- Idempotent.
-- =============================================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_type text DEFAULT 'enterprise';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_account_type_check'
      AND conrelid = 'public.accounts'::regclass
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_account_type_check
      CHECK (account_type IN ('real_estate','franchise','service','enterprise'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_accounts_account_type
  ON public.accounts (account_type)
  WHERE deleted_at IS NULL;

-- Backfill any NULLs to default explicitly (the DEFAULT only applies
-- to rows inserted after the migration).
UPDATE public.accounts
SET account_type = 'enterprise'
WHERE account_type IS NULL;

COMMENT ON COLUMN public.accounts.account_type IS
  'Business profile of the account: real_estate / franchise / service / enterprise. Drives portal UI branching and staff segmentation.';
