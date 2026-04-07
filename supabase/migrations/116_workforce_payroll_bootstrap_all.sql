-- =============================================================================
-- Workforce / People: full bootstrap for hosted DBs that only have a partial
-- payroll_internal_costs (or missing squads / self_bills columns).
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- Order: squads → payroll_internal_costs (091–093, 096) → self_bills (095) → storage (092) → RLS (099).
-- =============================================================================

-- ── 1) squads (Add squad — referenced by payroll_internal_costs.squad_id) ──
CREATE TABLE IF NOT EXISTS public.squads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.squads ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.squads ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_squads_deleted_at ON public.squads (deleted_at);

-- ── 2) payroll_internal_costs base (091) ──
CREATE TABLE IF NOT EXISTS public.payroll_internal_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text,
  description text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  category text,
  due_date date,
  status text NOT NULL DEFAULT 'pending',
  paid_at date,
  payee_name text,
  employment_type text,
  payment_day_of_month int,
  documents_on_file jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payroll_internal_costs
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS payee_name text,
  ADD COLUMN IF NOT EXISTS employment_type text,
  ADD COLUMN IF NOT EXISTS payment_day_of_month int,
  ADD COLUMN IF NOT EXISTS documents_on_file jsonb;

UPDATE public.payroll_internal_costs SET documents_on_file = '{}'::jsonb WHERE documents_on_file IS NULL;

ALTER TABLE public.payroll_internal_costs
  ALTER COLUMN documents_on_file SET DEFAULT '{}'::jsonb;

ALTER TABLE public.payroll_internal_costs
  ALTER COLUMN documents_on_file SET NOT NULL;

COMMENT ON COLUMN public.payroll_internal_costs.payee_name IS 'Person or entity paid (salary / contractor).';
COMMENT ON COLUMN public.payroll_internal_costs.employment_type IS 'employee | self_employed — drives document checklist in UI.';
COMMENT ON COLUMN public.payroll_internal_costs.payment_day_of_month IS 'Typical pay day 1–28; use due_date for the next concrete payment.';
COMMENT ON COLUMN public.payroll_internal_costs.documents_on_file IS 'Map doc_key -> on_file for HR / compliance.';

-- ── 3) pay frequency + payroll_document_files (092) ──
ALTER TABLE public.payroll_internal_costs
  ADD COLUMN IF NOT EXISTS pay_frequency text,
  ADD COLUMN IF NOT EXISTS payroll_document_files jsonb;

UPDATE public.payroll_internal_costs SET payroll_document_files = '{}'::jsonb WHERE payroll_document_files IS NULL;

ALTER TABLE public.payroll_internal_costs
  ALTER COLUMN payroll_document_files SET DEFAULT '{}'::jsonb;

ALTER TABLE public.payroll_internal_costs
  ALTER COLUMN payroll_document_files SET NOT NULL;

COMMENT ON COLUMN public.payroll_internal_costs.pay_frequency IS 'weekly | biweekly | monthly';
COMMENT ON COLUMN public.payroll_internal_costs.payroll_document_files IS 'doc_key -> { path, file_name } in storage bucket payroll-internal-documents';

-- ── 4) lifecycle + equity + payroll_profile (093) ──
ALTER TABLE public.payroll_internal_costs
  ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'onboarding',
  ADD COLUMN IF NOT EXISTS offboard_reason text,
  ADD COLUMN IF NOT EXISTS offboard_at timestamptz,
  ADD COLUMN IF NOT EXISTS recurring_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS has_equity boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS equity_percent numeric,
  ADD COLUMN IF NOT EXISTS equity_vesting_notes text,
  ADD COLUMN IF NOT EXISTS equity_start_date date,
  ADD COLUMN IF NOT EXISTS payroll_profile jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.payroll_internal_costs SET payroll_profile = '{}'::jsonb WHERE payroll_profile IS NULL;

ALTER TABLE public.payroll_internal_costs
  DROP CONSTRAINT IF EXISTS payroll_internal_costs_lifecycle_stage_check;

ALTER TABLE public.payroll_internal_costs
  ADD CONSTRAINT payroll_internal_costs_lifecycle_stage_check
  CHECK (lifecycle_stage IN ('onboarding', 'active', 'needs_attention', 'offboard'));

COMMENT ON COLUMN public.payroll_internal_costs.lifecycle_stage IS 'onboarding | active | needs_attention | offboard — Pay Run pulls only active + due in week';
COMMENT ON COLUMN public.payroll_internal_costs.offboard_reason IS 'Required when offboard; kept for audit.';
COMMENT ON COLUMN public.payroll_internal_costs.recurring_approved_at IS 'Set when user approves once to run as recurring cost until offboard.';
COMMENT ON COLUMN public.payroll_internal_costs.payroll_profile IS 'Optional JSON: utr, ni_number, tax_code, position, phone, address, vat_number, etc.';

UPDATE public.payroll_internal_costs
SET
  lifecycle_stage = 'active',
  recurring_approved_at = COALESCE(recurring_approved_at, updated_at)
WHERE employment_type IN ('employee', 'self_employed');

UPDATE public.payroll_internal_costs
SET lifecycle_stage = 'active'
WHERE employment_type IS NULL;

-- ── 5) squad_id FK (096) — requires squads ──
ALTER TABLE public.payroll_internal_costs
  ADD COLUMN IF NOT EXISTS squad_id uuid REFERENCES public.squads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS payroll_internal_costs_squad_id_idx
  ON public.payroll_internal_costs(squad_id)
  WHERE squad_id IS NOT NULL;

COMMENT ON COLUMN public.payroll_internal_costs.squad_id IS 'Optional squad (London, Midlands, …) — managed from People.';

-- ── 6) self_bills: internal workforce link (095) ──
ALTER TABLE public.self_bills
  ADD COLUMN IF NOT EXISTS bill_origin text;

UPDATE public.self_bills SET bill_origin = 'partner' WHERE bill_origin IS NULL;

ALTER TABLE public.self_bills
  ALTER COLUMN bill_origin SET DEFAULT 'partner';

ALTER TABLE public.self_bills
  ALTER COLUMN bill_origin SET NOT NULL;

ALTER TABLE public.self_bills
  DROP CONSTRAINT IF EXISTS self_bills_bill_origin_check;

ALTER TABLE public.self_bills
  ADD CONSTRAINT self_bills_bill_origin_check
  CHECK (bill_origin IN ('partner', 'internal'));

ALTER TABLE public.self_bills
  ADD COLUMN IF NOT EXISTS internal_cost_id uuid REFERENCES public.payroll_internal_costs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS self_bills_internal_cost_id_idx
  ON public.self_bills(internal_cost_id)
  WHERE internal_cost_id IS NOT NULL;

COMMENT ON COLUMN public.self_bills.bill_origin IS 'partner: linked to field partner jobs; internal: office payroll row (internal_cost_id).';
COMMENT ON COLUMN public.self_bills.internal_cost_id IS 'When bill_origin = internal, the payroll_internal_costs person row.';

-- ── 7) Storage bucket + policies for HR docs (092) ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payroll-internal-documents',
  'payroll-internal-documents',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "payroll_internal_docs_insert_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "payroll_internal_docs_select_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "payroll_internal_docs_update_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "payroll_internal_docs_delete_authenticated" ON storage.objects;

CREATE POLICY "payroll_internal_docs_insert_authenticated"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payroll-internal-documents');

CREATE POLICY "payroll_internal_docs_select_authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payroll-internal-documents');

CREATE POLICY "payroll_internal_docs_update_authenticated"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'payroll-internal-documents');

CREATE POLICY "payroll_internal_docs_delete_authenticated"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payroll-internal-documents');

-- ── 8) squads RLS (099) — optional if you get RLS errors on squads ──
ALTER TABLE public.squads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "squads_select_authenticated" ON public.squads;
CREATE POLICY "squads_select_authenticated"
  ON public.squads
  FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "squads_insert_authenticated" ON public.squads;
CREATE POLICY "squads_insert_authenticated"
  ON public.squads
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "squads_update_authenticated" ON public.squads;
CREATE POLICY "squads_update_authenticated"
  ON public.squads
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Notify PostgREST to reload (Supabase: Dashboard → Settings → API → reload schema, or wait a minute).
