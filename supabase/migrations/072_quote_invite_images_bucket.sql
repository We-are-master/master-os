-- Photos attached in Master OS when inviting partners to bid (stored URLs on quotes.images jsonb).
-- Public read so the partner app can load images without signed URLs.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quote-invite-images',
  'quote-invite-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public can read quote-invite-images" ON storage.objects;
CREATE POLICY "Public can read quote-invite-images"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'quote-invite-images');

DROP POLICY IF EXISTS "Authenticated can insert quote-invite-images" ON storage.objects;
CREATE POLICY "Authenticated can insert quote-invite-images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'quote-invite-images');

DROP POLICY IF EXISTS "Authenticated can update quote-invite-images" ON storage.objects;
CREATE POLICY "Authenticated can update quote-invite-images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'quote-invite-images')
  WITH CHECK (bucket_id = 'quote-invite-images');

DROP POLICY IF EXISTS "Authenticated can delete quote-invite-images" ON storage.objects;
CREATE POLICY "Authenticated can delete quote-invite-images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'quote-invite-images');

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.quotes.images IS 'JSON array of public storage URLs for partner invite photos (quote-invite-images bucket)';
