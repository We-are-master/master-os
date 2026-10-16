-- 336: entrada que a cotação pede no aceite, por conta (dono, 16/10/2026).
--
-- Cotação aceita abre o pagamento da entrada na hora. 50% para todo mundo; 0 para quem
-- paga na fatura (Housekeep e Express). Cliente sem conta = 50% (no código).
-- Escolha na conta: Automations > Payment > "Deposit on quote".

BEGIN;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS quote_deposit_percent smallint NOT NULL DEFAULT 50
  CHECK (quote_deposit_percent BETWEEN 0 AND 100);

COMMENT ON COLUMN public.accounts.quote_deposit_percent IS
  'Deposit % asked when a client accepts a quote (0 = no deposit, invoice later). Used when the quote has no deposit of its own.';

UPDATE public.accounts
SET quote_deposit_percent = 0
WHERE company_name IN ('Housekeep', 'Express');

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferência:
-- SELECT company_name, quote_deposit_percent FROM public.accounts WHERE deleted_at IS NULL ORDER BY 2, 1;
