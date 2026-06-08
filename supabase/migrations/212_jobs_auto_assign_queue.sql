-- Auto-assign offer queue columns (trade portal countdown + OS invite list).

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS auto_assign_invited_partner_ids uuid[] NULL,
  ADD COLUMN IF NOT EXISTS auto_assign_expires_at timestamptz NULL;

COMMENT ON COLUMN public.jobs.auto_assign_invited_partner_ids IS
  'Partners invited to claim an auto-assigning job (first accept wins).';
COMMENT ON COLUMN public.jobs.auto_assign_expires_at IS
  'Offer expiry for auto-assign invites; trade portal shows countdown from this.';
