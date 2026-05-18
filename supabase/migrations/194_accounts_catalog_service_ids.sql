-- Which catalogue services this corporate account can use (jobs, quotes, account pricing).

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS catalog_service_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.accounts.catalog_service_ids IS
  'Subset of service_catalog.id offered to this account; drives Service rates tab and job pricing scope.';

CREATE INDEX IF NOT EXISTS idx_accounts_catalog_service_ids
  ON public.accounts USING gin (catalog_service_ids);
