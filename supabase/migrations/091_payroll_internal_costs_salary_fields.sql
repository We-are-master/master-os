-- Company payroll / salary rows: payee, employment type, pay day, document checklist.

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
