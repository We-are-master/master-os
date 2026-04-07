-- Partial invoice payments + link job_payments rows back to an invoice (reopen / reporting).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN invoices.amount_paid IS 'Cumulative customer amount applied to this invoice; balance = amount - amount_paid.';

ALTER TABLE job_payments ADD COLUMN IF NOT EXISTS linked_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_payments_linked_invoice_id ON job_payments (linked_invoice_id)
  WHERE deleted_at IS NULL AND linked_invoice_id IS NOT NULL;
