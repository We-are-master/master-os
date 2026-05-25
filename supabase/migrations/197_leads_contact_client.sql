-- Migration 197: Leads contact fields + link to clients under Fixfy account

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS postcode text,
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_address_id uuid REFERENCES public.client_addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_client_id ON public.leads (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads (lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL;

COMMENT ON COLUMN public.leads.client_id IS 'Contact in clients directory (source_account_id = Fixfy corporate account).';
COMMENT ON COLUMN public.leads.account_id IS 'Denormalized Fixfy account id used when the lead was created.';
