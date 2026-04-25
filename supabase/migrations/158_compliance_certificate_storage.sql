-- =============================================================================
-- Migration 158: storage bucket for compliance certificates
-- =============================================================================
--
-- Bucket `compliance-certificates` holds the PDFs/images uploaded by
-- staff when registering an account_compliance_certificates row.
-- The path convention is:
--   compliance-certificates/{account_id}/{cert_id}.{ext}
--
-- Storage RLS:
--   - Authenticated users (staff + portal users) can READ — but the
--     bucket is private, so reads happen via signed URLs the OS / portal
--     mints from the service role. The SELECT policy is only there as a
--     safety net for any future client-side direct read.
--   - INSERT/UPDATE/DELETE only via service role (no policy → deny).
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'compliance-certificates',
  'compliance-certificates',
  false, -- private; signed URLs only
  20 * 1024 * 1024, -- 20 MB cap per cert
  ARRAY[
    'application/pdf',
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'image/heic', 'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Read policy: portal user can fetch a signed URL only if the cert
-- belongs to their account. Walks
-- compliance-certificates/{account_id}/{cert_id}.{ext}.
DROP POLICY IF EXISTS "Read own account compliance certs" ON storage.objects;
CREATE POLICY "Read own account compliance certs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'compliance-certificates'
    AND (
      public.is_internal_staff()
      OR (storage.foldername(name))[1] = public.current_portal_account_id()::text
    )
  );

COMMENT ON POLICY "Read own account compliance certs" ON storage.objects IS
  'Signed-URL reads happen via service role (which bypasses RLS), so this policy is defense-in-depth. The first folder segment in the object path is the account_id.';
