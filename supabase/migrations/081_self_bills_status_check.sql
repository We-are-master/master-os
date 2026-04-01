-- Align self_bills.status CHECK with app SelfBillStatus (weekly workflow uses "accumulating").
ALTER TABLE self_bills DROP CONSTRAINT IF EXISTS self_bills_status_check;

ALTER TABLE self_bills ADD CONSTRAINT self_bills_status_check CHECK (
  status IN (
    'accumulating',
    'pending_review',
    'needs_attention',
    'awaiting_payment',
    'ready_to_pay',
    'paid',
    'audit_required',
    'rejected'
  )
);
