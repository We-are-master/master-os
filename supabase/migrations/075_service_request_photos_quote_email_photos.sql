-- Site photos on service requests (public URLs, company-assets); optional attach to customer quote email.
ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS photo_urls text[] DEFAULT '{}';

COMMENT ON COLUMN service_requests.photo_urls IS 'Public URLs of site photos uploaded with the request; shown to partners on invite and optionally attached to customer quote emails.';

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS email_attach_request_photos boolean DEFAULT false;

COMMENT ON COLUMN quotes.email_attach_request_photos IS 'When true, customer quote email includes request site photos as attachments (if request_id and photos exist).';
