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

-- Backfill snapshot values for jobs cancelled BEFORE this migration shipped.
-- Two-source reconstruction (only fills where snapshot is NULL — idempotent):
--   1. Audit log: latest `field_name = '<col>'` row with `created_at < cancelled_at`
--      gives the value the user last set before cancelling.
--   2. Linked quote: `quotes.sell_price` via `jobs.quote_id` fills jobs that
--      were created from a quote and never had their price edited (so there's
--      no audit row for client_price).
-- Past `extras_amount` and `partner_cost` are less likely to be reconstructable
-- from quotes — they fall back to audit_logs only and remain NULL otherwise.

UPDATE jobs j
SET cancelled_client_price = sub.value
FROM (
  SELECT DISTINCT ON (a.entity_id) a.entity_id, NULLIF(a.new_value, '')::NUMERIC AS value
  FROM audit_logs a
  JOIN jobs jj ON jj.id = a.entity_id
  WHERE a.entity_type = 'job'
    AND a.field_name = 'client_price'
    AND jj.status = 'cancelled'
    AND jj.cancelled_at IS NOT NULL
    AND a.created_at < jj.cancelled_at
    AND jj.cancelled_client_price IS NULL
  ORDER BY a.entity_id, a.created_at DESC
) sub
WHERE j.id = sub.entity_id
  AND j.cancelled_client_price IS NULL
  AND sub.value IS NOT NULL;

UPDATE jobs j
SET cancelled_extras_amount = sub.value
FROM (
  SELECT DISTINCT ON (a.entity_id) a.entity_id, NULLIF(a.new_value, '')::NUMERIC AS value
  FROM audit_logs a
  JOIN jobs jj ON jj.id = a.entity_id
  WHERE a.entity_type = 'job'
    AND a.field_name = 'extras_amount'
    AND jj.status = 'cancelled'
    AND jj.cancelled_at IS NOT NULL
    AND a.created_at < jj.cancelled_at
    AND jj.cancelled_extras_amount IS NULL
  ORDER BY a.entity_id, a.created_at DESC
) sub
WHERE j.id = sub.entity_id
  AND j.cancelled_extras_amount IS NULL
  AND sub.value IS NOT NULL;

UPDATE jobs j
SET cancelled_partner_cost = sub.value
FROM (
  SELECT DISTINCT ON (a.entity_id) a.entity_id, NULLIF(a.new_value, '')::NUMERIC AS value
  FROM audit_logs a
  JOIN jobs jj ON jj.id = a.entity_id
  WHERE a.entity_type = 'job'
    AND a.field_name = 'partner_cost'
    AND jj.status = 'cancelled'
    AND jj.cancelled_at IS NOT NULL
    AND a.created_at < jj.cancelled_at
    AND jj.cancelled_partner_cost IS NULL
  ORDER BY a.entity_id, a.created_at DESC
) sub
WHERE j.id = sub.entity_id
  AND j.cancelled_partner_cost IS NULL
  AND sub.value IS NOT NULL;

-- Quote fallback for client_price + partner_cost: jobs created from a quote
-- that were cancelled without ever having pricing edited (so no audit row above).
UPDATE jobs j
SET cancelled_client_price = q.sell_price
FROM quotes q
WHERE j.quote_id = q.id
  AND j.status = 'cancelled'
  AND j.cancelled_client_price IS NULL
  AND q.sell_price IS NOT NULL
  AND q.sell_price > 0;

UPDATE jobs j
SET cancelled_partner_cost = q.partner_cost
FROM quotes q
WHERE j.quote_id = q.id
  AND j.status = 'cancelled'
  AND j.cancelled_partner_cost IS NULL
  AND q.partner_cost IS NOT NULL
  AND q.partner_cost > 0;
