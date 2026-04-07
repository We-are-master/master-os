-- payroll_internal_costs may lack documents_on_file on older DBs (PGRST204).
ALTER TABLE public.payroll_internal_costs
  ADD COLUMN IF NOT EXISTS documents_on_file jsonb;

UPDATE public.payroll_internal_costs SET documents_on_file = '{}'::jsonb WHERE documents_on_file IS NULL;

ALTER TABLE public.payroll_internal_costs
  ALTER COLUMN documents_on_file SET DEFAULT '{}'::jsonb;

ALTER TABLE public.payroll_internal_costs
  ALTER COLUMN documents_on_file SET NOT NULL;

COMMENT ON COLUMN public.payroll_internal_costs.documents_on_file IS
  'Map doc_key -> on_file for HR / compliance.';
