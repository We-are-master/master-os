-- Partner-facing payout void states when linked jobs are archived / cancelled / lost.
ALTER TABLE public.self_bills DROP CONSTRAINT IF EXISTS self_bills_status_check;

ALTER TABLE public.self_bills ADD CONSTRAINT self_bills_status_check CHECK (
  status IN (
    'accumulating',
    'pending_review',
    'needs_attention',
    'awaiting_payment',
    'ready_to_pay',
    'paid',
    'audit_required',
    'rejected',
    'payout_archived',
    'payout_cancelled',
    'payout_lost'
  )
);

ALTER TABLE public.self_bills
  ADD COLUMN IF NOT EXISTS original_net_payout numeric(14, 2),
  ADD COLUMN IF NOT EXISTS payout_void_reason text,
  ADD COLUMN IF NOT EXISTS partner_status_label text;

COMMENT ON COLUMN public.self_bills.original_net_payout IS 'Snapshot of net_payout before it was zeroed for audit (partner transparency).';
COMMENT ON COLUMN public.self_bills.payout_void_reason IS 'Automatic explanation when payout is no longer due.';
COMMENT ON COLUMN public.self_bills.partner_status_label IS 'Partner-readable status label for PDF/UI (Archived, Lost, Cancelled).';
