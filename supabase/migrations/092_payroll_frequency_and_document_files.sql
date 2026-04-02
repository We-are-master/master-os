-- Pay frequency + uploaded document paths (JSON). Storage bucket for payroll HR files.

ALTER TABLE public.payroll_internal_costs
  ADD COLUMN IF NOT EXISTS pay_frequency text,
  ADD COLUMN IF NOT EXISTS payroll_document_files jsonb;

UPDATE public.payroll_internal_costs SET payroll_document_files = '{}'::jsonb WHERE payroll_document_files IS NULL;

ALTER TABLE public.payroll_internal_costs
  ALTER COLUMN payroll_document_files SET DEFAULT '{}'::jsonb;

ALTER TABLE public.payroll_internal_costs
  ALTER COLUMN payroll_document_files SET NOT NULL;

COMMENT ON COLUMN public.payroll_internal_costs.pay_frequency IS 'weekly | biweekly | monthly';
COMMENT ON COLUMN public.payroll_internal_costs.payroll_document_files IS 'doc_key -> { path, file_name } in storage bucket payroll-internal-documents';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payroll-internal-documents',
  'payroll-internal-documents',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "payroll_internal_docs_insert_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "payroll_internal_docs_select_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "payroll_internal_docs_update_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "payroll_internal_docs_delete_authenticated" ON storage.objects;

CREATE POLICY "payroll_internal_docs_insert_authenticated"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payroll-internal-documents');

CREATE POLICY "payroll_internal_docs_select_authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payroll-internal-documents');

CREATE POLICY "payroll_internal_docs_update_authenticated"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'payroll-internal-documents');

CREATE POLICY "payroll_internal_docs_delete_authenticated"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payroll-internal-documents');
