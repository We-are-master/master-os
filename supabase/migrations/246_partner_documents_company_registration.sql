-- Proof of company uploads use doc_type `company_registration` (limited companies).
-- Migration 114 omitted this value from partner_documents_doc_type_check.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'partner_documents'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%doc_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.partner_documents DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.partner_documents ADD CONSTRAINT partner_documents_doc_type_check CHECK (
  doc_type IN (
    'insurance',
    'certification',
    'license',
    'contract',
    'tax',
    'id_proof',
    'other',
    'utr',
    'service_agreement',
    'self_bill_agreement',
    'proof_of_address',
    'right_to_work',
    'poa',
    'dbs',
    'company_registration'
  )
);
