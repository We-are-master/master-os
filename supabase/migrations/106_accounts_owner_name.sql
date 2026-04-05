-- Account owner (internal): sales / account manager, analogous to jobs.owner_name.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS owner_name text;

COMMENT ON COLUMN public.accounts.owner_name IS 'Internal account owner name (e.g. sales / AM), for reporting and dashboard rollups.';
