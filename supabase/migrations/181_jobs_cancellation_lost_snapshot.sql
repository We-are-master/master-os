-- Snapshot fields for "lost revenue" tracking on cancelled jobs.
-- The cancel flow zeroes `client_price`, `extras_amount`, and `partner_cost`
-- (see lib/job-cancel-economics.ts → patchOfficeCancelZeroJobEconomics) so we
-- can no longer read what the job was worth after cancellation. These columns
-- snapshot the values right before zeroing so dashboards (Pulse / Beacon
-- Kanban Cancelled column) can show the lost revenue per job and aggregate
-- across the period.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS cancelled_client_price NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS cancelled_extras_amount NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS cancelled_partner_cost NUMERIC NULL;

COMMENT ON COLUMN jobs.cancelled_client_price IS
  'Snapshot of client_price at the moment of office cancel (pre-zeroing). Drives "lost revenue" KPIs.';
COMMENT ON COLUMN jobs.cancelled_extras_amount IS
  'Snapshot of extras_amount at the moment of office cancel.';
COMMENT ON COLUMN jobs.cancelled_partner_cost IS
  'Snapshot of partner_cost at the moment of office cancel.';
