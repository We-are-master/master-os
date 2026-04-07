-- Partner compliance-driven status: reasons array + needs_attention stage.
-- Migrates legacy `on_break` into inactive + reason code `on_break`.

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS partner_status_reasons text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.partners.partner_status_reasons IS
  'Machine codes: missing_documents, low_compliance_score, expired_docs, on_break, other:...';

-- Move legacy on_break partners to inactive with a reason badge.
UPDATE public.partners
SET
  status = 'inactive',
  partner_status_reasons = CASE
    WHEN partner_status_reasons IS NULL OR array_length(partner_status_reasons, 1) IS NULL THEN ARRAY['on_break']::text[]
    WHEN 'on_break' = ANY(partner_status_reasons) THEN partner_status_reasons
    ELSE partner_status_reasons || ARRAY['on_break']::text[]
  END
WHERE status = 'on_break';
