-- payroll_internal_costs may lack payment_day_of_month on older DBs (PGRST204).
ALTER TABLE public.payroll_internal_costs
  ADD COLUMN IF NOT EXISTS payment_day_of_month int;

COMMENT ON COLUMN public.payroll_internal_costs.payment_day_of_month IS
  'Typical pay day 1–28; use due_date for the next concrete payment.';
