-- payroll_internal_costs may lack payee_name on older DBs (PGRST204).
ALTER TABLE public.payroll_internal_costs
  ADD COLUMN IF NOT EXISTS payee_name text;

COMMENT ON COLUMN public.payroll_internal_costs.payee_name IS
  'Person or entity paid (salary / contractor).';
