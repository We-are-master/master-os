-- Client dispute / manual audit queue (aligned with self_bills.audit_required).
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
  'Includes audit_required when a client contests the invoice (office review queue).';
