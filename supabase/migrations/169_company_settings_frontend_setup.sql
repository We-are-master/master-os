-- JSON bag for UI preferences (Settings → Setup). Extensible without new columns.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS frontend_setup jsonb NOT NULL DEFAULT '{"bidding_sla_hours": 8}'::jsonb;

COMMENT ON COLUMN public.company_settings.frontend_setup IS
  'Admin UI preferences: bidding SLA hours, future keys. Shapes UX labels and client-side deadlines; does not change quote rows.';
