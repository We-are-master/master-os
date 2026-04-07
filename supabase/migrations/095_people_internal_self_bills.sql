-- Internal workforce self-bills (employees / internal contractors) linked to payroll_internal_costs.

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
