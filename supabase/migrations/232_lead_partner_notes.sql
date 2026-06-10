-- Partner notes on interested leads (trade portal mini-CRM).

ALTER TABLE public.lead_partner_offers
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.lead_partner_offers.notes IS
  'Private partner notes after contacting a lead (trade portal).';
