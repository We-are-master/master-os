-- Optional end date for a recurring bill series; occurrences after this date are not scheduled
-- and existing future rows are archived once the end date has passed (see applyRecurringSeriesEndPause).
ALTER TABLE bills ADD COLUMN IF NOT EXISTS recurring_series_end_date date;

CREATE INDEX IF NOT EXISTS idx_bills_recurring_series_end_date
  ON bills (recurring_series_end_date)
  WHERE recurring_series_end_date IS NOT NULL;

COMMENT ON COLUMN bills.recurring_series_end_date IS
  'Last inclusive due date for this recurring series. Future lines are not generated past this date; rows with due_date after this are auto-archived once the end date is in the past.';
