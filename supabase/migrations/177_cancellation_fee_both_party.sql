-- Allow billing both client and partner on office cancel ("both").

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS cancellation_fee_client_gbp numeric;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS cancellation_fee_partner_gbp numeric;

COMMENT ON COLUMN public.jobs.cancellation_fee_client_gbp IS
  'When cancellation_fee_party=both: client-side fee (£); otherwise usually null (use cancellation_fee_gbp for client-only).';

COMMENT ON COLUMN public.jobs.cancellation_fee_partner_gbp IS
  'When cancellation_fee_party=both: partner owes (£); partner-only snapshot otherwise uses cancellation_fee_gbp + party=partner.';

COMMENT ON COLUMN public.jobs.cancellation_fee_party IS
  'none | client | partner | both — dashboard cancel snapshot.';

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_cancellation_fee_party_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_cancellation_fee_party_check CHECK (
    cancellation_fee_party IN ('none', 'client', 'partner', 'both')
  );
