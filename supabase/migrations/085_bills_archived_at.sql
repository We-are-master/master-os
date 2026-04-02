-- Hide bills from the main operating list without deleting workflow history.
ALTER TABLE bills ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_bills_archived_at_null
  ON bills (archived_at)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN bills.archived_at IS 'When set, bill is archived (excluded from default Bills tab and pay-run picks).';
