-- UK payout / BACS-style bank details for directory partners (Financial tab).

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS bank_sort_code text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_account_holder text,
  ADD COLUMN IF NOT EXISTS bank_name text;

COMMENT ON COLUMN public.partners.bank_sort_code IS '6 digits, UK sort code (stored without hyphens).';
COMMENT ON COLUMN public.partners.bank_account_number IS 'UK account number, digits only.';
COMMENT ON COLUMN public.partners.bank_account_holder IS 'Name on the account.';
COMMENT ON COLUMN public.partners.bank_name IS 'Bank / building society name.';
