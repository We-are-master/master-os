-- Monthly pipeline sales goal (GBP) for Overview → Sales goal widget
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS dashboard_sales_goal_monthly numeric DEFAULT 35000;

COMMENT ON COLUMN company_settings.dashboard_sales_goal_monthly IS 'Monthly sales goal (GBP) for dashboard pipeline vs target bar; scaled by selected date range.';
