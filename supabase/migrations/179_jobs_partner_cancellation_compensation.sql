-- Office/client-driven cancellation: optional GBP compensation owed *to* the partner (distinct from clawback).

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS partner_cancellation_compensation_gbp numeric;

COMMENT ON COLUMN public.jobs.partner_cancellation_compensation_gbp IS
  'When office cancels after client abandonment: GBP compensation owed to partner (additive in self-bill rollup). Survives post-cancel zero-out of labour fields. Mutually orthogonal to partner clawback snapshots.';
