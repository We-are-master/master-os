-- Defaults for office cancellation fees (Account / Partner / company-wide) +
-- Snapshot on job when cancelling from dashboard.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS default_client_cancel_fee_gbp numeric;

COMMENT ON COLUMN public.accounts.default_client_cancel_fee_gbp IS
  'Suggested cancellation fee (£) billed to client when cancelling jobs for clients linked to this account — office may override per cancel.';

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS default_partner_cancel_fee_gbp numeric;

COMMENT ON COLUMN public.partners.default_partner_cancel_fee_gbp IS
  'Suggested clawback (£) when partner owes a cancellation fee — office may override per cancel; falls back to company_settings.partner_cancellation_fee_gbp.';

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS default_client_cancel_fee_gbp numeric;

COMMENT ON COLUMN public.company_settings.default_client_cancel_fee_gbp IS
  'Fallback suggested client cancellation fee (£) when Account default is unset.';

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS cancellation_fee_gbp numeric;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS cancellation_fee_party text NOT NULL DEFAULT 'none';

COMMENT ON COLUMN public.jobs.cancellation_fee_party IS
  'none | client | partner — snapshot at dashboard cancel alongside cancellation_fee_gbp.';

COMMENT ON COLUMN public.jobs.cancellation_fee_gbp IS
  'Office cancellation fee amount (£) agreed at cancel time — separate from partner app cancel fields when applicable.';

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS cancellation_fee_invoice_id uuid REFERENCES public.invoices (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.jobs.cancellation_fee_invoice_id IS
  'When cancellation_fee_party=client and a draft invoice was created for the fee, link it here for audit.';

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_cancellation_fee_party_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_cancellation_fee_party_check CHECK (
    cancellation_fee_party IN ('none', 'client', 'partner')
  );
