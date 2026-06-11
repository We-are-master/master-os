-- Partner payout plan template on recurring series (mirrors payment_plan_template for client).

ALTER TABLE public.job_recurrence_series
  ADD COLUMN IF NOT EXISTS partner_payment_plan_template jsonb NULL;

COMMENT ON COLUMN public.job_recurrence_series.partner_payment_plan_template IS
  'Optional partner payout plan at series create: { enabled, installments: [{ amount, due_date }] }.';
