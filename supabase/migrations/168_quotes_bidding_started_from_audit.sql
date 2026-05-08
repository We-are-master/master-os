-- Improve bidding_started_at for existing rows: use the last audit transition *into* bidding
-- (more accurate than updated_at for "how long stuck" + SLA breach metrics).

CREATE INDEX IF NOT EXISTS idx_audit_logs_quote_entered_bidding
  ON public.audit_logs (entity_id, created_at DESC)
  WHERE entity_type = 'quote'
    AND action = 'status_changed'
    AND field_name = 'status'
    AND new_value = 'bidding';

WITH last_enter AS (
  SELECT
    entity_id::uuid AS id,
    MAX(created_at) AS entered_at
  FROM public.audit_logs
  WHERE entity_type = 'quote'
    AND action = 'status_changed'
    AND field_name = 'status'
    AND new_value = 'bidding'
  GROUP BY entity_id
)
UPDATE public.quotes q
SET bidding_started_at = le.entered_at
FROM last_enter le
WHERE q.id = le.id
  AND q.status = 'bidding'::text
  AND q.deleted_at IS NULL;
