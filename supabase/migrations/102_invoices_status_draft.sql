-- Allow invoice status `draft` (not yet issued to the client).
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'paid', 'pending', 'partially_paid', 'overdue', 'cancelled'));
