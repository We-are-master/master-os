-- Partner-facing job confirmation email notes (per type of work + job-type overrides).

ALTER TABLE public.service_catalog
  ADD COLUMN IF NOT EXISTS partner_email_notes_hourly text,
  ADD COLUMN IF NOT EXISTS partner_email_notes_fixed text,
  ADD COLUMN IF NOT EXISTS partner_email_notes_default text;

COMMENT ON COLUMN public.service_catalog.partner_email_notes_hourly IS
  'Optional override for hourly jobs in partner job offer/booked emails. Empty = OS global hourly default.';

COMMENT ON COLUMN public.service_catalog.partner_email_notes_fixed IS
  'Optional override for fixed jobs in partner job offer/booked emails. Empty = OS global fixed default.';

COMMENT ON COLUMN public.service_catalog.partner_email_notes_default IS
  'Type-of-work rules appended after the hourly/fixed note (e.g. Gardener bag rate).';

-- Seed Gardener trade-specific note (global hourly/fixed defaults live in app code).
UPDATE public.service_catalog
SET partner_email_notes_default = E'🌱 Standard rate: £5 per bag. Extra hours need customer approval on site. If 2 people: divide hours by 2 (e.g. 2hrs = 1hr each).'
WHERE name = 'Gardener'
  AND deleted_at IS NULL
  AND (partner_email_notes_default IS NULL OR btrim(partner_email_notes_default) = '');
