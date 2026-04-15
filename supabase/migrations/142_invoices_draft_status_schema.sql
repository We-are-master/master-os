-- Ensures the invoices schema supports draft-status creation from createJob.
-- Defensive / idempotent: safe to re-run even if 080 / 102 / 103 were already applied.
--
-- Bug: creating a job from Jobs-tab modal fails because
--   1. `amount_paid` column is missing in some DBs (migration 080 not applied).
--   2. `invoices_status_check` rejects `'draft'` (migration 102 not applied).

-- 1. Ensure amount_paid exists (re-apply 080).
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.invoices.amount_paid IS
  'Cumulative customer amount applied to this invoice; balance = amount - amount_paid.';

-- 2. Re-apply the status CHECK so `draft` + `audit_required` are accepted (102 + 103).
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (
    status IN (
      'draft',
      'paid',
      'pending',
      'partially_paid',
      'overdue',
      'cancelled',
      'audit_required'
    )
  );

COMMENT ON COLUMN public.invoices.status IS
  'draft = not yet issued to the client; pending = issued & awaiting payment; audit_required = client-disputed / office review.';

-- 3. Refresh PostgREST schema cache so the API layer sees amount_paid immediately.
NOTIFY pgrst, 'reload schema';
