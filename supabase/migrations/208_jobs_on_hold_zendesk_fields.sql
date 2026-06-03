-- On-hold: stable reason preset id (Zendesk dropdown) + complaint description for partner email.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS on_hold_reason_preset_id text,
  ADD COLUMN IF NOT EXISTS on_hold_complaint_description text;

COMMENT ON COLUMN public.jobs.on_hold_reason_preset_id IS
  'Stable on-hold reason id (matches Settings presets and Zendesk dropdown value), e.g. complaint, waiting_materials.';
COMMENT ON COLUMN public.jobs.on_hold_complaint_description IS
  'Customer complaint detail — shown to the assigned partner in the on-hold email and synced to Zendesk.';
