-- Migration 262: fecha os jobs que já foram pagos e ficaram em `awaiting_payment`
--
-- A Zia (finance) reconcilia o extrato do Checkatrade e da Housekeep e marcava
-- `payment_status` e `finance_status` como pagos, mas nunca tocava em `status`.
-- O job ficava esperando um pagamento que já tinha entrado. Medido em
-- 20/08/2026: 30 jobs assim, 29 com a invoice também quitada, £4.382.
--
-- Os scripts da Zia já foram corrigidos para fechar na hora. Isto limpa o que
-- ficou para trás.
--
-- TRÊS GUARDAS, e cada uma custou um caso real:
--
--   1. Só de `awaiting_payment`. Job em `final_check` pode ter dinheiro dentro
--      e relatório pendente, e fechá-lo pularia a entrega que o cliente cobra.
--   2. Só com `finance_status = 'paid'`. É a coluna que o código sempre manteve.
--   3. Só com a INVOICE também paga. O JOB-9406 tem finance=paid com a invoice
--      RCP-2026-647 ainda em `pending`: é a "cobrança falsa" que a própria Zia
--      reporta, e fechar o job esconderia o problema em vez de resolvê-lo.

UPDATE public.jobs j
   SET status = 'completed'
  FROM public.invoices i
 WHERE j.invoice_id     = i.id
   AND j.status         = 'awaiting_payment'
   AND j.finance_status = 'paid'
   AND i.status         = 'paid'
   AND j.deleted_at IS NULL;

-- Confere. Deve sobrar SÓ o JOB-9406, que é problema de verdade:
--   SELECT j.reference, j.status, j.finance_status, i.reference AS invoice, i.status AS invoice_status
--     FROM public.jobs j
--     LEFT JOIN public.invoices i ON i.id = j.invoice_id
--    WHERE j.status = 'awaiting_payment'
--      AND j.finance_status = 'paid'
--      AND j.deleted_at IS NULL;
