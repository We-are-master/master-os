-- Allow client-side labour allocations on extra ledger rows (discounts vs client_price).
ALTER TABLE public.job_extra_entries
  DROP CONSTRAINT IF EXISTS job_extra_entries_allocation_check;

ALTER TABLE public.job_extra_entries
  ADD CONSTRAINT job_extra_entries_allocation_check
  CHECK (allocation IN ('labour', 'extras', 'materials', 'partner_cost'));
