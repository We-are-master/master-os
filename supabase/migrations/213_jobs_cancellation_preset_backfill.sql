-- Preset id for Pulse grouping + backfill lost-value snapshots still missing.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS cancellation_reason_preset_id text NULL;

COMMENT ON COLUMN public.jobs.cancellation_reason_preset_id IS
  'Office/Zendesk cancel preset id (client_requested, other, …). Drives Pulse lost-revenue breakdown.';

-- Zendesk webhook audit rows
UPDATE public.jobs j
SET cancellation_reason_preset_id = sub.preset_id
FROM (
  SELECT DISTINCT ON (a.entity_id)
    a.entity_id,
    a.metadata->>'cancellation_reason_id' AS preset_id
  FROM public.audit_logs a
  WHERE a.entity_type = 'job'
    AND a.new_value = 'cancelled'
    AND a.metadata->>'source' = 'zendesk_cancellation_webhook'
    AND a.metadata->>'cancellation_reason_id' IS NOT NULL
    AND trim(a.metadata->>'cancellation_reason_id') <> ''
  ORDER BY a.entity_id, a.created_at DESC
) sub
WHERE j.id = sub.entity_id
  AND j.status = 'cancelled'
  AND j.cancellation_reason_preset_id IS NULL;

-- Re-run quote sell_price fallback for cancelled_client_price still null
UPDATE public.jobs j
SET cancelled_client_price = q.sell_price
FROM public.quotes q
WHERE j.quote_id = q.id
  AND j.status = 'cancelled'
  AND j.cancelled_client_price IS NULL
  AND q.sell_price IS NOT NULL
  AND q.sell_price > 0;

-- Audit fallback for client_price (migration 181 pattern, idempotent)
UPDATE public.jobs j
SET cancelled_client_price = sub.value
FROM (
  SELECT DISTINCT ON (a.entity_id) a.entity_id, NULLIF(a.new_value, '')::NUMERIC AS value
  FROM public.audit_logs a
  JOIN public.jobs jj ON jj.id = a.entity_id
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
