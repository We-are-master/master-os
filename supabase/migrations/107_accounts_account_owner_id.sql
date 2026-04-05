-- Link corporate account to internal owner profile (dashboard rollups).

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_account_owner_id ON public.accounts (account_owner_id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.accounts.account_owner_id IS 'Internal profile (sales/AM) owning this account; used for Top account owners KPIs.';
