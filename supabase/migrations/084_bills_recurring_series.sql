-- Links rows created in one recurring batch so the UI can group them reliably.
ALTER TABLE bills ADD COLUMN IF NOT EXISTS recurring_series_id uuid;

CREATE INDEX IF NOT EXISTS idx_bills_recurring_series_id
  ON bills (recurring_series_id)
  WHERE recurring_series_id IS NOT NULL;
