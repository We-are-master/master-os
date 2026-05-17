-- =============================================================================
-- Migration 185: Optional display icon slug per catalogue row (app maps Lucide).
-- =============================================================================

ALTER TABLE public.service_catalog
  ADD COLUMN IF NOT EXISTS display_icon_key text NULL;

COMMENT ON COLUMN public.service_catalog.display_icon_key IS
  'Slug for UI icon palette (Partners, etc.). NULL = derive from service name via app heuristic. Controlled values match ServiceDisplayIconSlug in the app.';

UPDATE public.service_catalog
SET display_icon_key = CASE lower(trim(name))
  WHEN 'painter' THEN 'painter'
  WHEN 'general maintenance' THEN 'general'
  WHEN 'plumber' THEN 'plumber'
  WHEN 'electrician' THEN 'electrician'
  WHEN 'builder' THEN 'builder'
  WHEN 'carpenter' THEN 'carpenter'
  WHEN 'cleaning' THEN 'cleaning'
  WHEN 'gardener' THEN 'gardener'
  WHEN 'boiler service' THEN 'heating'
  WHEN 'electrical installation condition report (eicr)' THEN 'electrician'
  WHEN 'portable appliance testing (pat)' THEN 'electrician'
  WHEN 'gas safety certificate (gsc)' THEN 'heating'
  WHEN 'fire risk assessment (fra)' THEN 'fire_safety'
  WHEN 'fire alarm certificate' THEN 'fire_safety'
  WHEN 'emergency lighting certificate' THEN 'fire_safety'
  WHEN 'fire extinguisher service (fes)' THEN 'fire_safety'
  ELSE display_icon_key
END
WHERE deleted_at IS NULL;
