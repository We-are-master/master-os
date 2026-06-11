-- Account-fault cancel defaults + cancellation_fault audit on jobs.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS default_account_fault_partner_comp_gbp numeric NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS default_account_fault_client_charge_gbp numeric NULL DEFAULT 50;

COMMENT ON COLUMN public.company_settings.default_account_fault_partner_comp_gbp IS
  'Default £ Fixfy pays partner when cancel is account fault (office modal preset).';
COMMENT ON COLUMN public.company_settings.default_account_fault_client_charge_gbp IS
  'Default £ charged to account/client when cancel is account fault (office modal preset).';

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS cancellation_fault text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_cancellation_fault_check'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_cancellation_fault_check
      CHECK (cancellation_fault IS NULL OR cancellation_fault IN ('partner', 'account', 'custom'));
  END IF;
END $$;

COMMENT ON COLUMN public.jobs.cancellation_fault IS
  'Office cancel fault preset: partner | account | custom (audit).';
