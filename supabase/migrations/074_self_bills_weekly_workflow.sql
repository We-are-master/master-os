-- Weekly partner self-bills: one row per partner per ISO week (Mon–Sun), many jobs per bill.
ALTER TABLE self_bills
  ADD COLUMN IF NOT EXISTS partner_id uuid,
  ADD COLUMN IF NOT EXISTS week_start date,
  ADD COLUMN IF NOT EXISTS week_end date,
  ADD COLUMN IF NOT EXISTS week_label text,
  ADD COLUMN IF NOT EXISTS payment_cadence text DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS pdf_generated_at timestamptz;

COMMENT ON COLUMN self_bills.partner_id IS 'Same id as jobs.partner_id (partner app user / partners link).';
COMMENT ON COLUMN self_bills.week_start IS 'ISO week Monday (date).';
COMMENT ON COLUMN self_bills.week_end IS 'ISO week Sunday (date).';
COMMENT ON COLUMN self_bills.week_label IS 'e.g. 2026-W13 for filters and PDF.';
COMMENT ON COLUMN self_bills.payment_cadence IS 'weekly | biweekly | monthly — hints finance when marking paid.';

-- App dedupes concurrent inserts; optional unique index can be added after backfill:
-- CREATE UNIQUE INDEX ... ON self_bills (partner_id, week_start) WHERE status = 'accumulating';
