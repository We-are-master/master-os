-- =============================================================================
-- Migration 155: compliance certificates + PPM plans
-- =============================================================================
--
-- Two new domain tables the portal v2 UI surfaces but master-os never
-- modelled. Both depend on the helpers from migration 148
-- (current_portal_account_id, is_internal_staff). Apply 148 first.
--
-- - account_compliance_certificates: per-property cert tracking with
--   expiry. Drives the Compliance tab inside the PropertyDrawer + the
--   "Compliance overview" block on the dashboard.
-- - account_ppm_plans: planned-preventive-maintenance schedules per
--   property. Drives the PPM tab + Live View calendar's PPM events.
--
-- Both idempotent.
-- =============================================================================

-- =============================================
-- 1. compliance certificates
-- =============================================
-- days_left is computed on read in the application layer
-- (portal-compliance.ts: days_left = expiry_date - today). Postgres
-- rejects CURRENT_DATE in a GENERATED ... STORED column because
-- CURRENT_DATE is STABLE not IMMUTABLE; a STORED value would also
-- freeze at insert time and never refresh, so it wouldn't be useful
-- anyway.
CREATE TABLE IF NOT EXISTS public.account_compliance_certificates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  property_id     uuid REFERENCES public.account_properties(id) ON DELETE CASCADE,
  certificate_type text NOT NULL,
  issued_date     date,
  expiry_date     date NOT NULL,
  status          text NOT NULL DEFAULT 'ok',
  document_path   text,
  notes           text,
  last_checked_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_compliance_certificates_type_check'
  ) THEN
    ALTER TABLE public.account_compliance_certificates
      ADD CONSTRAINT account_compliance_certificates_type_check
      CHECK (certificate_type IN (
        'gas_safe','eicr','epc','pat','fire_safety',
        'legionella','asbestos','other'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_compliance_certificates_status_check'
  ) THEN
    ALTER TABLE public.account_compliance_certificates
      ADD CONSTRAINT account_compliance_certificates_status_check
      CHECK (status IN ('ok','expiring','expired','missing'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_compliance_certs_account_expiry
  ON public.account_compliance_certificates (account_id, expiry_date)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_compliance_certs_property
  ON public.account_compliance_certificates (property_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_compliance_certs_attention
  ON public.account_compliance_certificates (account_id, status, expiry_date)
  WHERE status != 'ok' AND deleted_at IS NULL;

ALTER TABLE public.account_compliance_certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "compliance_certs_select_scoped" ON public.account_compliance_certificates;
CREATE POLICY "compliance_certs_select_scoped"
  ON public.account_compliance_certificates FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR account_id = public.current_portal_account_id()
  );
-- Inserts/updates/deletes go through staff via service role; no
-- portal-user write policies are added on purpose.

COMMENT ON TABLE public.account_compliance_certificates IS
  'Per-property compliance certificates (Gas Safe / EICR / PAT / Fire / Legionella). Read-only for portal users; staff registers via dashboard.';

-- =============================================
-- 2. PPM plans
-- =============================================
-- Note: there's no FK to partner_contracts here on purpose — that
-- table doesn't exist in this Supabase project yet. If/when it ships
-- a follow-up migration can add the column + constraint.
CREATE TABLE IF NOT EXISTS public.account_ppm_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  property_id         uuid REFERENCES public.account_properties(id) ON DELETE CASCADE,
  catalog_service_id  uuid REFERENCES public.service_catalog(id) ON DELETE SET NULL,
  name                text NOT NULL,
  frequency           text NOT NULL DEFAULT 'monthly',
  frequency_days      integer,
  next_visit_date     date,
  last_visit_date     date,
  status              text NOT NULL DEFAULT 'active',
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_ppm_plans_frequency_check'
  ) THEN
    ALTER TABLE public.account_ppm_plans
      ADD CONSTRAINT account_ppm_plans_frequency_check
      CHECK (frequency IN (
        'weekly','fortnightly','monthly','quarterly',
        'semi_annual','yearly','custom'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_ppm_plans_status_check'
  ) THEN
    ALTER TABLE public.account_ppm_plans
      ADD CONSTRAINT account_ppm_plans_status_check
      CHECK (status IN ('active','paused','cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ppm_plans_account_next_visit
  ON public.account_ppm_plans (account_id, next_visit_date)
  WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_ppm_plans_property
  ON public.account_ppm_plans (property_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.account_ppm_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ppm_plans_select_scoped" ON public.account_ppm_plans;
CREATE POLICY "ppm_plans_select_scoped"
  ON public.account_ppm_plans FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR account_id = public.current_portal_account_id()
  );

COMMENT ON TABLE public.account_ppm_plans IS
  'Planned preventive maintenance schedules per account/property. Read-only for portal users.';
