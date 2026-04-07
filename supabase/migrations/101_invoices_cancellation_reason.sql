-- Reason copied from job cancellation when job-linked invoices are auto-cancelled.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS cancellation_reason text;

COMMENT ON COLUMN public.invoices.cancellation_reason IS
  'When status is cancelled: office/partner context (e.g. mirrored from jobs.cancellation_reason on job cancel).';
