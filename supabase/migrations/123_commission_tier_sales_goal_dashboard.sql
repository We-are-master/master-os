-- Per-tier monthly sales goal (GBP) + optional selection for Overview dashboard target.
ALTER TABLE public.commission_tiers
  ADD COLUMN IF NOT EXISTS sales_goal_monthly numeric;

COMMENT ON COLUMN public.commission_tiers.sales_goal_monthly IS
  'Optional monthly sales target (GBP) for this tier; used when company_settings.dashboard_sales_goal_tier_id points here.';

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS dashboard_sales_goal_tier_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'company_settings_dashboard_sales_goal_tier_id_fkey'
      AND conrelid = 'public.company_settings'::regclass
  ) THEN
    ALTER TABLE public.company_settings
      ADD CONSTRAINT company_settings_dashboard_sales_goal_tier_id_fkey
      FOREIGN KEY (dashboard_sales_goal_tier_id)
      REFERENCES public.commission_tiers (id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.company_settings.dashboard_sales_goal_tier_id IS
  'When set, Overview sales goal uses commission_tiers.sales_goal_monthly for that tier; otherwise dashboard_sales_goal_monthly.';
