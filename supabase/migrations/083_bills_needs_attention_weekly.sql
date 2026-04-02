-- Company bills: allow needs_attention status and weekly recurrence text values.
ALTER TABLE bills DROP CONSTRAINT IF EXISTS bills_status_check;
ALTER TABLE bills ADD CONSTRAINT bills_status_check CHECK (
  status IN ('submitted', 'approved', 'paid', 'rejected', 'needs_attention')
);

COMMENT ON COLUMN bills.recurrence_interval IS 'weekly | monthly | quarterly | yearly — pre-generated occurrences, not chained only on mark paid';
