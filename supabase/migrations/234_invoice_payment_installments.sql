-- Invoice payment plan: installments per receivable invoice + recurring series template.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_plan_active boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.invoices.payment_plan_active IS
  'True when invoice_payment_installments rows define collection schedule.';

ALTER TABLE public.job_recurrence_series
  ADD COLUMN IF NOT EXISTS payment_plan_template jsonb NULL;

COMMENT ON COLUMN public.job_recurrence_series.payment_plan_template IS
  'Optional payment plan defined at series create: { enabled, installments: [{ amount, due_date }] }.';

CREATE TABLE IF NOT EXISTS public.invoice_payment_installments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  sequence    integer NOT NULL,
  amount      numeric NOT NULL CHECK (amount >= 0),
  due_date    date NOT NULL,
  status      text NOT NULL DEFAULT 'pending',
  paid_at     timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_payment_installments_status_check'
  ) THEN
    ALTER TABLE public.invoice_payment_installments
      ADD CONSTRAINT invoice_payment_installments_status_check
      CHECK (status IN ('pending', 'paid', 'cancelled'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_payment_installments_invoice_seq_uq
  ON public.invoice_payment_installments (invoice_id, sequence);

CREATE INDEX IF NOT EXISTS invoice_payment_installments_invoice_id_idx
  ON public.invoice_payment_installments (invoice_id);

CREATE INDEX IF NOT EXISTS invoice_payment_installments_due_date_idx
  ON public.invoice_payment_installments (due_date)
  WHERE status = 'pending';

COMMENT ON TABLE public.invoice_payment_installments IS
  'Receivable payment plan lines: amount + due_date per installment.';

ALTER TABLE public.invoice_payment_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_payment_installments_authenticated_all"
  ON public.invoice_payment_installments;
CREATE POLICY "invoice_payment_installments_authenticated_all"
  ON public.invoice_payment_installments
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
