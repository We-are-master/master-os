-- Allow client rate-card snapshots (HTML + PDF + JSON) in public company-assets bucket.
-- Existing paths: account logos, partner avatars, job compliance PDFs, etc.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-assets',
  'company-assets',
  true,
  52428800,
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/html',
    'application/json'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = GREATEST(storage.buckets.file_size_limit, EXCLUDED.file_size_limit),
  allowed_mime_types = (
    SELECT ARRAY(
      SELECT DISTINCT unnest(
        COALESCE(storage.buckets.allowed_mime_types, ARRAY[]::text[])
        || EXCLUDED.allowed_mime_types
      )
    )
  );

DROP POLICY IF EXISTS "Public can read company-assets" ON storage.objects;
CREATE POLICY "Public can read company-assets"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'company-assets');
