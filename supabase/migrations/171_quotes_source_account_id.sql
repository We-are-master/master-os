-- Persist the corporate account chosen when creating a routing invite without a linked client,
-- so the drawer can resolve finance/main email without requiring "Change account" first.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS source_account_id uuid REFERENCES public.accounts (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.quotes.source_account_id IS
  'B2B routing: account selected at invite when there is no client_id; used to resolve inbox / quote header.';

-- Best-effort: older routing drafts stored only `client_name` (account label) with no `client_id` / `property_id`.
-- Only set when exactly one non-deleted account matches the normalised company name (avoids ambiguous matches).
WITH matches AS (
  SELECT
    q.id AS quote_id,
    a.id AS account_id,
    count(*) OVER (PARTITION BY q.id) AS match_count
  FROM public.quotes q
  INNER JOIN public.accounts a
    ON lower(trim(both FROM coalesce(q.client_name, ''))) = lower(trim(both FROM coalesce(a.company_name, '')))
   AND length(trim(both FROM coalesce(q.client_name, ''))) > 0
  WHERE q.deleted_at IS NULL
    AND a.deleted_at IS NULL
    AND q.client_id IS NULL
    AND q.property_id IS NULL
    AND q.source_account_id IS NULL
    AND q.status = 'draft'
)
UPDATE public.quotes q
SET source_account_id = m.account_id
FROM matches m
WHERE q.id = m.quote_id
  AND m.match_count = 1;
