-- Partner-cancellation money rails on jobs: four columns the code already reads/writes
-- but production never received (178 only added the company_settings default + RPC;
-- 179 existed in the repo and was never applied).
--
-- Without these, "Pay the partner" on the office cancel modal silently drops the
-- amount (schema-compat strips the column) and the weekly self-bill recomputes to 0.
-- JOB-9436 (18/08/2026, £200 compensation) is the case that surfaced it.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS partner_cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS partner_cancellation_reason text,
  ADD COLUMN IF NOT EXISTS partner_cancellation_fee numeric,
  ADD COLUMN IF NOT EXISTS partner_cancellation_compensation_gbp numeric;

COMMENT ON COLUMN public.jobs.partner_cancelled_at IS
  'Set when the PARTNER cancels via app/RPC (mig 178). Office cancellations leave this null.';
COMMENT ON COLUMN public.jobs.partner_cancellation_reason IS
  'Partner-app cancellation reason (mig 178 RPC).';
COMMENT ON COLUMN public.jobs.partner_cancellation_fee IS
  'GBP the partner owes Fixfy after partner-app cancellation (clawback on weekly self-bill).';
COMMENT ON COLUMN public.jobs.partner_cancellation_compensation_gbp IS
  'When office cancels after client abandonment: GBP compensation owed to partner (additive in self-bill rollup). Survives post-cancel zero-out of labour fields. Mutually orthogonal to partner clawback snapshots.';
