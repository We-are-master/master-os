-- =============================================================================
-- Migration 154: column extensions for portal v2
-- =============================================================================
--
-- Small additive columns the portal v2 UI shows but master-os never modeled.
-- All idempotent (ADD COLUMN IF NOT EXISTS) so safe to re-run.
--
-- - jobs.priority + service_requests.priority (P1/P2/P3/P4)
-- - account_properties.property_code, account_properties.branch
--   (portal lists show a per-account code + region/branch label)
-- - account_property_documents.document_type (categories the portal
--   filters by: report / compliance / photo / quote / invoice /
--   tenancy / site_info)
-- =============================================================================

-- =============================================
-- 1. jobs.priority + service_requests.priority
-- =============================================
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'p3';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jobs_priority_check' AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_priority_check
      CHECK (priority IN ('p1','p2','p3','p4'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_priority_active
  ON public.jobs (priority) WHERE deleted_at IS NULL;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'p3';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_requests_priority_p_check'
      AND conrelid = 'public.service_requests'::regclass
  ) THEN
    -- Note: service_requests already has a priority CHECK on different
    -- enum (low/medium/high/urgent — see migration 005). We add a
    -- separate CHECK just for the p1/p2/p3/p4 namespace if missing.
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_priority_p_check
      CHECK (priority IS NULL OR priority IN (
        'p1','p2','p3','p4',
        -- Legacy values still accepted for backward compat
        'low','medium','high','urgent'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_requests_priority_active
  ON public.service_requests (priority) WHERE deleted_at IS NULL;

-- =============================================
-- 2. account_properties.property_code + branch
-- =============================================
ALTER TABLE public.account_properties
  ADD COLUMN IF NOT EXISTS property_code text,
  ADD COLUMN IF NOT EXISTS branch text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_properties_code
  ON public.account_properties (account_id, property_code)
  WHERE property_code IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_account_properties_branch
  ON public.account_properties (account_id, branch)
  WHERE branch IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN public.account_properties.property_code IS
  'Account-scoped human reference (e.g. "HW-MAR-204"). Unique within account.';
COMMENT ON COLUMN public.account_properties.branch IS
  'Region / branch grouping shown in portal site lists.';

-- =============================================
-- 3. account_property_documents.document_type
-- =============================================
ALTER TABLE public.account_property_documents
  ADD COLUMN IF NOT EXISTS document_type text DEFAULT 'other';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_property_documents_type_check'
      AND conrelid = 'public.account_property_documents'::regclass
  ) THEN
    ALTER TABLE public.account_property_documents
      ADD CONSTRAINT account_property_documents_type_check
      CHECK (document_type IN (
        'report','compliance','photo','quote','invoice',
        'tenancy','site_info','other'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_account_property_documents_type
  ON public.account_property_documents (property_id, document_type);

COMMENT ON COLUMN public.account_property_documents.document_type IS
  'Category used by portal docs filter. Default ''other'' for legacy rows; UI surfaces as the global Documents tag.';
