-- Persist whether the request was created as a quote lead vs work (call-out) lead.
ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS request_kind text;

ALTER TABLE service_requests
  DROP CONSTRAINT IF EXISTS service_requests_request_kind_check;

ALTER TABLE service_requests
  ADD CONSTRAINT service_requests_request_kind_check
  CHECK (request_kind IS NULL OR request_kind IN ('quote', 'work'));

COMMENT ON COLUMN service_requests.request_kind IS 'quote | work — set at creation; legacy rows may be NULL.';

-- Reasonable backfill: catalog template implies work-style request; otherwise treat as quote.
UPDATE service_requests
SET request_kind = CASE
  WHEN catalog_service_id IS NOT NULL THEN 'work'
  ELSE 'quote'
END
WHERE request_kind IS NULL;
