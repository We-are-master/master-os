-- Weekly consolidated invoices (Every N days account terms): one row per account per ISO week.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS billing_week_start date;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS source_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_weekly_billing
  ON public.invoices (source_account_id, billing_week_start)
  WHERE deleted_at IS NULL AND source_account_id IS NOT NULL;

COMMENT ON COLUMN public.invoices.billing_week_start IS 'ISO Monday of the week for consolidated weekly billing (Every N days terms).';
COMMENT ON COLUMN public.invoices.source_account_id IS 'Account whose jobs are rolled into this weekly invoice.';
