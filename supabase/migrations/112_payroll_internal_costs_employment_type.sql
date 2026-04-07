-- Hosted DBs that created payroll_internal_costs before 091 may lack employment_type (PGRST204 on insert).
ALTER TABLE public.payroll_internal_costs
  ADD COLUMN IF NOT EXISTS employment_type text;

COMMENT ON COLUMN public.payroll_internal_costs.employment_type IS
  'employee | self_employed — drives document checklist in UI.';
