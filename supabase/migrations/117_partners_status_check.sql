-- Align `partners.status` CHECK with app types (`PartnerStatus` in src/types/database.ts).
-- Older DBs often only allowed e.g. active/inactive; opening the partner drawer triggers
-- updates to onboarding / needs_attention / on_break and fails with 23514 otherwise.

ALTER TABLE public.partners DROP CONSTRAINT IF EXISTS partners_status_check;

ALTER TABLE public.partners ADD CONSTRAINT partners_status_check CHECK (
  status IN (
    'active',
    'inactive',
    'onboarding',
    'needs_attention',
    'on_break'
  )
);

COMMENT ON CONSTRAINT partners_status_check ON public.partners IS
  'Directory lifecycle: active, inactive, onboarding, needs_attention, on_break (legacy top-level on_break).';
