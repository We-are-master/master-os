-- Allow B2B quotes with account + site/address only; contact linked at job conversion.
-- Safe if already nullable (Postgres allows repeated DROP NOT NULL).

ALTER TABLE public.quotes
  ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE public.quotes
  ALTER COLUMN client_address_id DROP NOT NULL;

COMMENT ON COLUMN public.quotes.client_id IS
  'End-client contact (clients row). Nullable when quote is account/site only until converted to job.';
