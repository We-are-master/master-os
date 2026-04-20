-- Store the computed due date on each self-bill so it can be overridden manually
-- and recalculated in bulk when partner payment_terms change.
-- NULL means "use the default Friday-after-week-end rule" for display purposes.
ALTER TABLE self_bills
  ADD COLUMN IF NOT EXISTS due_date DATE NULL;
