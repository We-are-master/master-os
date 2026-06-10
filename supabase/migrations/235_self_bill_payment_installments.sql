-- Partner payout plan: installments per self-bill (mirrors invoice_payment_installments).

ALTER TABLE public.self_bills
  ADD COLUMN IF NOT EXISTS payment_plan_active boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.self_bills.payment_plan_active IS
  'True when self_bill_payment_installments rows define partner payout schedule.';

CREATE TABLE IF NOT EXISTS public.self_bill_payment_installments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  self_bill_id  uuid NOT NULL REFERENCES public.self_bills(id) ON DELETE CASCADE,
  sequence      integer NOT NULL,
  amount        numeric NOT NULL CHECK (amount >= 0),
  due_date      date NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  paid_at       timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'self_bill_payment_installments_status_check'
  ) THEN
    ALTER TABLE public.self_bill_payment_installments
      ADD CONSTRAINT self_bill_payment_installments_status_check
      CHECK (status IN ('pending', 'paid', 'cancelled'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS self_bill_payment_installments_sb_seq_uq
  ON public.self_bill_payment_installments (self_bill_id, sequence);

CREATE INDEX IF NOT EXISTS self_bill_payment_installments_self_bill_id_idx
  ON public.self_bill_payment_installments (self_bill_id);

CREATE INDEX IF NOT EXISTS self_bill_payment_installments_due_date_idx
  ON public.self_bill_payment_installments (due_date)
  WHERE status = 'pending';

COMMENT ON TABLE public.self_bill_payment_installments IS
  'Partner payout plan lines: amount + due_date per installment.';

ALTER TABLE public.self_bill_payment_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self_bill_payment_installments_authenticated_all"
  ON public.self_bill_payment_installments;
CREATE POLICY "self_bill_payment_installments_authenticated_all"
  ON public.self_bill_payment_installments
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
