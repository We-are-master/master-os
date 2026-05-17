-- Master Brain (admin) + Daily brief cron columns on company_settings.
-- Safe to run multiple times.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS master_brain_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS daily_brief_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS daily_brief_morning_time text NOT NULL DEFAULT '08:00';

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS daily_brief_evening_time text NOT NULL DEFAULT '18:00';

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS daily_brief_timezone text NOT NULL DEFAULT 'Europe/London';

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS daily_brief_emails text NOT NULL DEFAULT '';

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS daily_brief_last_morning_ymd text NULL;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS daily_brief_last_evening_ymd text NULL;

COMMENT ON COLUMN public.company_settings.master_brain_enabled IS
  'Admin: show Fixfy Brain floating assistant for admin role.';

COMMENT ON COLUMN public.company_settings.daily_brief_enabled IS
  'Cron-driven morning/evening HTML e-mails with ops metrics.';

COMMENT ON COLUMN public.company_settings.daily_brief_morning_time IS
  'Local time HH:MM for morning brief (company timezone).';

COMMENT ON COLUMN public.company_settings.daily_brief_evening_time IS
  'Local time HH:MM for evening brief (company timezone).';

COMMENT ON COLUMN public.company_settings.daily_brief_timezone IS
  'IANA timezone for brief scheduling (e.g. Europe/London).';

COMMENT ON COLUMN public.company_settings.daily_brief_emails IS
  'Comma-separated recipient e-mails for daily brief.';

COMMENT ON COLUMN public.company_settings.daily_brief_last_morning_ymd IS
  'Last local calendar date (YYYY-MM-DD) morning brief was sent.';

COMMENT ON COLUMN public.company_settings.daily_brief_last_evening_ymd IS
  'Last local calendar date (YYYY-MM-DD) evening brief was sent.';
