-- Site / problem photos on the inbound request; copied to quotes.images when converting to quote / bidding.

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.service_requests.images IS 'JSON array of public storage URLs (quote-invite-images); merged into quotes.images on convert';
