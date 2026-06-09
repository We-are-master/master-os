-- Migration 224: Wise Business payout linkage on self_bills + partners
--
-- Phase 3 of the Going Out · Money Out feature. Records the Wise transfer
-- minted for each self-bill payout so the UI can flip the row state from
-- "Sent" → "Paid" and the Payment History tab can show transfer status
-- without re-querying Wise.

ALTER TABLE public.self_bills
  ADD COLUMN IF NOT EXISTS wise_transfer_id  text,
  ADD COLUMN IF NOT EXISTS wise_paid_at      timestamptz,
  ADD COLUMN IF NOT EXISTS wise_status       text;

COMMENT ON COLUMN public.self_bills.wise_transfer_id IS
  'Wise Business transfer id minted for this self-bill payout (full or per-job).';
COMMENT ON COLUMN public.self_bills.wise_paid_at IS
  'Stamp when the Wise transfer was funded successfully. Drives "Paid" pill in the widget.';
COMMENT ON COLUMN public.self_bills.wise_status IS
  'Last-known Wise transfer status (created, funded, outgoing_payment_sent, refunded, …). Sync via webhook or polling.';

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS wise_recipient_id text;

COMMENT ON COLUMN public.partners.wise_recipient_id IS
  'Cached Wise account/recipient id for this partner. First-time pay creates a recipient and stamps it here; subsequent transfers reuse.';

CREATE INDEX IF NOT EXISTS self_bills_wise_transfer_id_idx
  ON public.self_bills (wise_transfer_id) WHERE wise_transfer_id IS NOT NULL;
