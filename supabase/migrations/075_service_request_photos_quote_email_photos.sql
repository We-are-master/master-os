-- Customer quote email: optional attach site images from linked service request (see migration 073 `service_requests.images`).
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS email_attach_request_photos boolean DEFAULT false;

COMMENT ON COLUMN quotes.email_attach_request_photos IS 'When true, customer quote email includes request site photos as attachments (if request_id and images exist).';
