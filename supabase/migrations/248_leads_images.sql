-- Lead attachment photos.
--
-- Mirrors service_requests.images (mig 073): a JSON array of public image URLs
-- stored in the `quote-invite-images` bucket. Lets the office attach site /
-- reference photos to a lead so they show in the Leads table + detail drawer,
-- and can flow through to partners when the lead is offered.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
