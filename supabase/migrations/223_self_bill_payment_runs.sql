-- Migration 223: Self-bill payment runs + Zendesk linkage on self_bills
--
-- Powers the new "Send self-bills" flow on the Going Out · Money Out widget:
-- one Zendesk master ticket per standard payment cycle (and a per-event ticket
-- for off-cycle sends), with each partner's send recorded as a Zendesk side
-- conversation inside that ticket. The widget reads `email_sent_at` to flip
-- the per-row button from "Send" → "Resend" and shows a clickable badge to
-- the linked ticket.

ALTER TABLE public.self_bills
  ADD COLUMN IF NOT EXISTS email_sent_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS zendesk_ticket_id             text,
  ADD COLUMN IF NOT EXISTS zendesk_ticket_url            text,
  ADD COLUMN IF NOT EXISTS zendesk_side_conversation_id  text,
  ADD COLUMN IF NOT EXISTS payment_run_id                uuid;

COMMENT ON COLUMN public.self_bills.email_sent_at IS
  'Timestamp of last successful partner send (Resend + Zendesk side conv). Drives Resend button + ticket badge in the billing widget.';
COMMENT ON COLUMN public.self_bills.zendesk_ticket_id IS
  'Zendesk master ticket id for the last send (mirrors self_bill_payment_runs.zendesk_ticket_id).';
COMMENT ON COLUMN public.self_bills.zendesk_ticket_url IS
  'Direct Zendesk URL of the master ticket for the last send — cached for the badge link without re-querying Zendesk.';
COMMENT ON COLUMN public.self_bills.zendesk_side_conversation_id IS
  'Zendesk side conversation id inside the master ticket — the per-partner thread for this self-bill.';
COMMENT ON COLUMN public.self_bills.payment_run_id IS
  'FK to self_bill_payment_runs — groups self-bills under one Zendesk master ticket.';

CREATE TABLE IF NOT EXISTS public.self_bill_payment_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_kind          text NOT NULL CHECK (cycle_kind IN ('standard', 'off_cycle')),
  period_start        date NOT NULL,
  period_end          date NOT NULL,
  expected_pay_date   date,
  zendesk_ticket_id   text,
  zendesk_ticket_url  text,
  total_amount        numeric NOT NULL DEFAULT 0,
  self_bill_ids       uuid[] NOT NULL DEFAULT '{}',
  created_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.self_bill_payment_runs IS
  'One row per Zendesk master ticket created by the self-bill send flow. Standard runs are upserted by (cycle_kind, period_start, period_end); off-cycle runs are always new.';

-- Prevent duplicate standard-run tickets when "Send all" is clicked twice for the
-- same payment cycle. Off-cycle runs intentionally bypass the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS self_bill_payment_runs_standard_uniq
  ON public.self_bill_payment_runs (cycle_kind, period_start, period_end)
  WHERE cycle_kind = 'standard';

CREATE INDEX IF NOT EXISTS self_bill_payment_runs_pay_date_idx
  ON public.self_bill_payment_runs (expected_pay_date DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS self_bills_payment_run_id_idx
  ON public.self_bills (payment_run_id) WHERE payment_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS self_bills_email_sent_at_idx
  ON public.self_bills (email_sent_at DESC NULLS LAST);

ALTER TABLE public.self_bills
  ADD CONSTRAINT self_bills_payment_run_id_fkey
  FOREIGN KEY (payment_run_id) REFERENCES public.self_bill_payment_runs(id) ON DELETE SET NULL
  NOT VALID;

ALTER TABLE public.self_bills VALIDATE CONSTRAINT self_bills_payment_run_id_fkey;

-- Keep updated_at fresh on payment runs (mirrors the pattern used by other tables).
CREATE OR REPLACE FUNCTION public.touch_self_bill_payment_runs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_self_bill_payment_runs_updated_at ON public.self_bill_payment_runs;
CREATE TRIGGER trg_self_bill_payment_runs_updated_at
  BEFORE UPDATE ON public.self_bill_payment_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_self_bill_payment_runs_updated_at();

-- RLS: tickets and runs are staff/finance-only. Anon and authenticated end-users
-- have no access; service role (used by the send endpoint) bypasses RLS.
ALTER TABLE public.self_bill_payment_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS self_bill_payment_runs_select_staff ON public.self_bill_payment_runs;
CREATE POLICY self_bill_payment_runs_select_staff ON public.self_bill_payment_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'manager')
    )
  );
