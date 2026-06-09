-- Migration 225: Self-bill internal approval gate
--
-- Adds the office signoff step that sits between sending the partner PDF and
-- minting a Wise transfer. The Going Out · Money Out widget exposes a
-- Pending / Approved toggle:
--   • Pending  — approved_at IS NULL: rows can be sent, reviewed, approved.
--   • Approved — approved_at IS NOT NULL AND wise_paid_at IS NULL: rows can be
--     paid via Wise; the wise-pay endpoint refuses unapproved rows.
--
-- Audit trail lives in audit_logs (action='approved' / 'unapproved') with
-- approved_by + ts metadata.

ALTER TABLE public.self_bills
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.self_bills.approved_at IS
  'Internal office signoff timestamp — required before Wise payout fires. Cleared by Unapprove.';
COMMENT ON COLUMN public.self_bills.approved_by IS
  'Profile id of the user who clicked Approve. Cleared by Unapprove.';

CREATE INDEX IF NOT EXISTS self_bills_approved_at_idx
  ON public.self_bills (approved_at DESC NULLS LAST)
  WHERE approved_at IS NOT NULL;
