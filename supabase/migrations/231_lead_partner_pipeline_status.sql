-- Partner mini-CRM pipeline status on lead contact rows (trade portal).

ALTER TABLE public.lead_partner_offers
  ADD COLUMN IF NOT EXISTS pipeline_status text NOT NULL DEFAULT 'contacted'
    CHECK (pipeline_status IN ('contacted', 'in_quote', 'won', 'lost'));

COMMENT ON COLUMN public.lead_partner_offers.pipeline_status IS
  'Partner-side CRM stage after revealing lead contact details.';

CREATE INDEX IF NOT EXISTS idx_lead_partner_offers_partner_pipeline
  ON public.lead_partner_offers (partner_id, pipeline_status);
