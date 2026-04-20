-- Add payment_terms to partners so partner-specific payout schedules can differ
-- from the default Friday-after-week-end rule.
-- Uses the same free-text format as accounts.payment_terms.
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS payment_terms TEXT NULL;
