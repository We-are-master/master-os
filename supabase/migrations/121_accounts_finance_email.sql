-- Optional billing contact email for invoices.
-- Keeps main `accounts.email` for primary contact while allowing finance-specific inbox.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS finance_email text;

COMMENT ON COLUMN public.accounts.finance_email IS
  'Optional billing/invoice email when different from main account email.';

