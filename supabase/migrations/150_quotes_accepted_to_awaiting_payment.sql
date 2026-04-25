-- Migration 150: rename quote status 'accepted' to 'awaiting_payment'.
--
-- Context: 'accepted' was used for quotes the customer had approved but whose
-- deposit invoice was still pending Stripe payment. The new name makes that
-- pending-payment state explicit. Quotes without a deposit now skip this stage
-- entirely and go directly to 'converted_to_job' on customer accept (handled
-- by src/app/api/quotes/respond/route.ts).
--
-- Steps:
--  1. Drop the existing status CHECK so we can rewrite historical rows.
--  2. Migrate data ('accepted' -> 'awaiting_payment') on quotes + audit logs.
--  3. Recreate the CHECK with the canonical status set, enforcing the new name.

BEGIN;

-- 1. Drop the existing constraint (if present) so the UPDATE below passes.
ALTER TABLE public.quotes
  DROP CONSTRAINT IF EXISTS quotes_status_check;

-- 2a. Migrate any remaining rows that still use the legacy value.
UPDATE public.quotes
   SET status = 'awaiting_payment'
 WHERE status = 'accepted';

-- 2b. Rewrite audit log entries that referenced the old value so history
--     reads consistently with the new vocabulary. Remove these two UPDATEs
--     if you would rather preserve the literal historical value.
UPDATE public.audit_logs
   SET new_value = 'awaiting_payment'
 WHERE entity_type = 'quote'
   AND field_name = 'status'
   AND new_value = 'accepted';

UPDATE public.audit_logs
   SET old_value = 'awaiting_payment'
 WHERE entity_type = 'quote'
   AND field_name = 'status'
   AND old_value = 'accepted';

-- 3. Recreate the CHECK with the full canonical status list.
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_status_check
  CHECK (
    status IN (
      'draft',
      'in_survey',
      'bidding',
      'awaiting_customer',
      'awaiting_payment',
      'rejected',
      'converted_to_job'
    )
  );

COMMIT;
