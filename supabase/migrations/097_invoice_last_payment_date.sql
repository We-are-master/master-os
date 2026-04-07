-- Last customer payment date (partial or full) for invoice UI / dashboard.

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS last_payment_date date;

COMMENT ON COLUMN public.invoices.last_payment_date IS 'Most recent customer payment date from job ledger or partial payment (when not fully paid).';
