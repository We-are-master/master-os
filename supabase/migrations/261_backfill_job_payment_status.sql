-- Migration 261: alinha `jobs.payment_status` com `jobs.finance_status`
--
-- As duas colunas dizem o mesmo fato: o cliente pagou. O código escrevia só
-- `finance_status`, porque `payment_status` nunca foi declarada no tipo `Job`
-- e o TypeScript recusava a escrita. Resultado medido em 20/08/2026:
--
--   finance=paid   | payment=paid     228   sincronizadas
--   finance=unpaid | payment=unpaid   233   sincronizadas
--   finance=paid   | payment=unpaid    16   ← divergiram, £3.379
--   finance=unpaid | payment=paid       0   nunca acontece
--
-- A checagem de coerência da Zia lê `payment_status`, então esses 16 apareciam
-- todo dia como "recebido mas job aberto" em job que estava fechado e pago.
--
-- O código já foi corrigido para escrever as duas juntas (na quitação, no force
-- close da tela e na reabertura da fatura). Isto aqui só limpa o passado.
--
-- Direção única de propósito: `finance_status` é a coluna que o código sempre
-- manteve, então ela é a verdade. Nunca o contrário.

UPDATE public.jobs
   SET payment_status = finance_status
 WHERE payment_status IS DISTINCT FROM finance_status
   AND deleted_at IS NULL;

-- Confere que zerou. Deve devolver nenhuma linha:
--   SELECT reference, status, finance_status, payment_status
--     FROM public.jobs
--    WHERE payment_status IS DISTINCT FROM finance_status
--      AND deleted_at IS NULL;
