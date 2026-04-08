-- Global defaults: which partner mandatory doc requirement ids are excluded from document compliance score (admin: Settings).
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS compliance_score_excluded_doc_ids text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.company_settings.compliance_score_excluded_doc_ids IS
  'Requirement ids (RequiredDocDef) excluded from partner document compliance score company-wide.';
