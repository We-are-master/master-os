-- Align `pay_run_items.item_type` CHECK with app (`PayRunItemType` in src/types/database.ts
-- and syncPayRunItems in src/services/pay-runs.ts).
-- Older DBs often only allowed e.g. self_bill + payroll; loading Pay Run then fails with 23514
-- when inserting internal_cost (workforce) or bill lines.

ALTER TABLE public.pay_run_items DROP CONSTRAINT IF EXISTS pay_run_items_item_type_check;

ALTER TABLE public.pay_run_items ADD CONSTRAINT pay_run_items_item_type_check CHECK (
  item_type IN (
    'self_bill',
    'internal_cost',
    'bill',
    'payroll'
  )
);

COMMENT ON CONSTRAINT pay_run_items_item_type_check ON public.pay_run_items IS
  'Partner self-bills, workforce payroll_internal_costs, supplier bills, legacy commission lines.';
