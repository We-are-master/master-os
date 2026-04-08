-- Per-file control: when false, the document is kept on file but excluded from compliance score matching.
ALTER TABLE public.partner_documents
  ADD COLUMN IF NOT EXISTS counts_toward_compliance boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.partner_documents.counts_toward_compliance IS
  'When false, the row is ignored for compliance checklist matching (reference copy only).';
