-- Migration 162: Backfill external_source / external_ref on quotes and jobs
-- from their service_request lineage.
--
-- Self-contained: also ensures the columns and indexes exist (re-doing what
-- migration 161 does) so this migration can be applied even if 161 was
-- skipped or partially applied.
--
-- Chain:
--   service_requests (has external_ref from inbound webhook)
--      └─→ quotes.request_id  ──→ quotes
--             └─→ jobs.quote_id  ──→ jobs
--
-- Idempotent: only fills rows where the target field is NULL.

-- ── 0. Ensure columns + indexes exist on all 3 tables ───────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_ref    text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_external_ref
  ON public.jobs (external_source, external_ref)
  WHERE external_source IS NOT NULL AND external_ref IS NOT NULL;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_ref    text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotes_external_ref
  ON public.quotes (external_source, external_ref)
  WHERE external_source IS NOT NULL AND external_ref IS NOT NULL;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_ref    text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_requests_external_ref
  ON public.service_requests (external_source, external_ref)
  WHERE external_source IS NOT NULL AND external_ref IS NOT NULL;

DO $$
DECLARE
  q_updated int := 0;
  j_updated int := 0;
  q_with_ref int := 0;
  j_with_ref int := 0;
BEGIN
  -- ── 1. Quotes inherit from their service_request ─────────────────
  WITH src AS (
    SELECT q.id AS quote_id,
           sr.external_source,
           sr.external_ref
    FROM   public.quotes q
    JOIN   public.service_requests sr ON sr.id = q.request_id
    WHERE  q.request_id IS NOT NULL
  )
  UPDATE public.quotes q
  SET external_source = COALESCE(q.external_source, src.external_source),
      external_ref    = COALESCE(q.external_ref,    src.external_ref)
  FROM src
  WHERE src.quote_id = q.id
    AND (
      (q.external_source IS NULL AND src.external_source IS NOT NULL) OR
      (q.external_ref    IS NULL AND src.external_ref    IS NOT NULL)
    );
  GET DIAGNOSTICS q_updated = ROW_COUNT;
  RAISE NOTICE '[backfill] quotes updated: %', q_updated;

  -- ── 2. Jobs inherit from their quote ─────────────────────────────
  WITH src AS (
    SELECT j.id AS job_id,
           q.external_source,
           q.external_ref
    FROM   public.jobs j
    JOIN   public.quotes q ON q.id = j.quote_id
    WHERE  j.quote_id IS NOT NULL
  )
  UPDATE public.jobs j
  SET external_source = COALESCE(j.external_source, src.external_source),
      external_ref    = COALESCE(j.external_ref,    src.external_ref)
  FROM src
  WHERE src.job_id = j.id
    AND (
      (j.external_source IS NULL AND src.external_source IS NOT NULL) OR
      (j.external_ref    IS NULL AND src.external_ref    IS NOT NULL)
    );
  GET DIAGNOSTICS j_updated = ROW_COUNT;
  RAISE NOTICE '[backfill] jobs updated:   %', j_updated;

  -- ── 3. Final state report ────────────────────────────────────────
  SELECT count(*) INTO q_with_ref FROM public.quotes WHERE external_ref IS NOT NULL;
  SELECT count(*) INTO j_with_ref FROM public.jobs   WHERE external_ref IS NOT NULL;
  RAISE NOTICE '[backfill] quotes with external_ref: %', q_with_ref;
  RAISE NOTICE '[backfill] jobs   with external_ref: %', j_with_ref;
END $$;
