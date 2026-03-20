-- Link clients.source_account_id to corporate accounts (not client_source_accounts lookup seeds)

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_source_account_id_fkey;

-- Old IDs pointed at client_source_accounts; they are not valid account UUIDs
UPDATE public.clients c
SET source_account_id = NULL
WHERE c.source_account_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = c.source_account_id);

ALTER TABLE public.clients
  ADD CONSTRAINT clients_source_account_id_fkey
  FOREIGN KEY (source_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
