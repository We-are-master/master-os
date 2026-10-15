-- 334 · Colunas que o código usa e que não existiam em produção (achado no teste de ponta a ponta, 15/10/2026)
--
-- As migrations 070 (review_sent_at, review_send_method) e 231 (on_hold_previous_status)
-- não chegaram inteiras ao banco. Efeito:
--   - o e-mail final ao cliente saía, mas o job não registrava review_sent_at / review_send_method
--     (o update falhava calado);
--   - pausar e retomar a fatura junto com o job (holdLinkedInvoicesForJob /
--     releaseLinkedInvoicesForJob) quebrava sempre: a fatura nunca ia para on_hold.
-- Só as colunas; nenhuma regra (CHECK de status) é recriada aqui.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS review_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_send_method text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_review_send_method_check') THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_review_send_method_check
      CHECK (review_send_method IS NULL OR review_send_method IN ('email', 'manual'));
  END IF;
END $$;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS on_hold_previous_status text NULL;

COMMENT ON COLUMN public.invoices.on_hold_previous_status IS
  'Invoice status before job hold; restored when job resumes from on_hold.';

-- O PostgREST precisa enxergar as colunas novas sem esperar o cache.
NOTIFY pgrst, 'reload schema';
