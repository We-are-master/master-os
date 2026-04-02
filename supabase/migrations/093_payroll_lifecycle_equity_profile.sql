-- Staff lifecycle (Pay Run only when active), offboard archive, equity, optional UK profile JSON.

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

-- Existing staff rows: treat as already approved recurring (Pay Run eligible when due).
UPDATE public.payroll_internal_costs
SET
  lifecycle_stage = 'active',
  recurring_approved_at = COALESCE(recurring_approved_at, updated_at)
WHERE employment_type IN ('employee', 'self_employed');

-- One-off internal lines (no employment type): stay operational in ledger.
UPDATE public.payroll_internal_costs
SET lifecycle_stage = 'active'
WHERE employment_type IS NULL;
