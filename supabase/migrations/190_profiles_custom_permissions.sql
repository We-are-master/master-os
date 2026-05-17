-- Per-user permission overrides (Settings → Users Access).
-- Safe to run multiple times.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS custom_permissions jsonb NULL;

COMMENT ON COLUMN public.profiles.custom_permissions IS
  'Per-user permission overrides: true = grant, false = revoke, absent = inherit role default.';
