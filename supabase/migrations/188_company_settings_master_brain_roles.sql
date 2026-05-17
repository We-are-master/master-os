-- Master Brain toggles + instructions for manager / operator roles.
-- Safe to run multiple times.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS master_brain_manager_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS master_brain_operator_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS master_brain_manager_instructions text NULL;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS master_brain_operator_instructions text NULL;

COMMENT ON COLUMN public.company_settings.master_brain_manager_enabled IS
  'Manager role: show Fixfy Brain with quote pipeline context.';

COMMENT ON COLUMN public.company_settings.master_brain_operator_enabled IS
  'Operator role: show Fixfy Brain with jobs owned by the user.';

COMMENT ON COLUMN public.company_settings.master_brain_manager_instructions IS
  'Optional admin instructions appended to manager Brain prompts.';

COMMENT ON COLUMN public.company_settings.master_brain_operator_instructions IS
  'Optional admin instructions appended to operator Brain prompts.';
