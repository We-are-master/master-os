-- Home / business address map pin (distinct from live GPS and coverage base pin).

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS partner_address_latitude double precision NULL,
  ADD COLUMN IF NOT EXISTS partner_address_longitude double precision NULL;

COMMENT ON COLUMN public.partners.partner_address_latitude IS
  'Geocoded latitude for partner_address — used for Live map partner pins (not live GPS).';
COMMENT ON COLUMN public.partners.partner_address_longitude IS
  'Geocoded longitude for partner_address — used for Live map partner pins (not live GPS).';
