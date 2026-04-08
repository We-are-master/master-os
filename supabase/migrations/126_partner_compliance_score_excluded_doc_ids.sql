-- Per-partner opt-out of mandatory doc types for blended document compliance score (admin UI).
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS compliance_score_excluded_doc_ids text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.partners.compliance_score_excluded_doc_ids IS
  'IDs from RequiredDocDef (e.g. public_liability, utr_hmrc) excluded from document compliance score; empty = all defaults apply.';
