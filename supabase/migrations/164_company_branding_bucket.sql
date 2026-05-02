-- Migration 164: Public storage bucket for company branding assets
-- (logos used on PDFs / customer emails, favicon for the dashboard).
--
-- Public read because <img> tags need to load without auth (Stripe-hosted
-- emails, customer-facing PDFs). Writes restricted to authenticated staff.
--
-- Path convention (one file per kind so uploads overwrite cleanly):
--   pdf-logo/{originalName}        — quote PDFs + customer emails
--   favicon/{originalName}         — browser tab icon
--   email-header/{originalName}    — optional email header banner

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-branding',
  'company-branding',
  true,
  5242880, -- 5MB cap (logos shouldn't be huge)
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Anyone can read (logos appear in customer-facing emails + PDFs)
DROP POLICY IF EXISTS "Public can read company-branding" ON storage.objects;
CREATE POLICY "Public can read company-branding"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'company-branding');

-- Only authenticated staff can upload / overwrite / delete
DROP POLICY IF EXISTS "Authenticated can insert company-branding" ON storage.objects;
CREATE POLICY "Authenticated can insert company-branding"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-branding');

DROP POLICY IF EXISTS "Authenticated can update company-branding" ON storage.objects;
CREATE POLICY "Authenticated can update company-branding"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'company-branding')
  WITH CHECK (bucket_id = 'company-branding');

DROP POLICY IF EXISTS "Authenticated can delete company-branding" ON storage.objects;
CREATE POLICY "Authenticated can delete company-branding"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-branding');
