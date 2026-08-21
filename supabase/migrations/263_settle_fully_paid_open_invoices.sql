-- Migration 263: fecha invoice que já recebeu tudo e continuou aberta
--
-- É a "COBRANCA FALSA" que a Zia reporta todo dia: invoice cujo `amount_paid`
-- já cobre o `amount` e cujo status continua `pending` ou `overdue`. Ela some
-- do card "To collect" (o saldo é zero e o loop pula saldo <= 0.02), mas
-- continua viva na checagem de coerência e no relatório dela.
--
-- Medido em 20/08/2026: 1 caso, RCP-2026-647 do JOB-9406, £127 de £127.
--
-- A comparação é `>=` com um centavo de folga, porque pagamento de plataforma
-- chega com arredondamento e exigir igualdade exata deixaria de fora o caso de
-- £127,00 contra £126,999.
--
-- NÃO toca em invoice paga a MENOS (fica aberta, que é o certo) nem em invoice
-- paga a MAIS: essa é o INV-2026-177 do JOB-8944, que tem £3.078 recebidos
-- contra £1.428 faturados e é uma reclamação de Checkatrade Guarantee sendo
-- negociada direto com a cliente (ticket 45997). Ali o valor da fatura é que
-- está errado, e corrigir isso é decisão comercial, não de migração.

UPDATE public.invoices
   SET status         = 'paid',
       paid_date      = COALESCE(paid_date, CURRENT_DATE),
       collection_stage = 'completed'
 WHERE status IN ('pending', 'overdue')
   AND amount_paid >= amount - 0.01
   AND amount_paid <= amount + 0.01
   AND deleted_at IS NULL;

-- Confere. Deve sobrar só o INV-2026-177, que é o caso da reclamação:
--   SELECT reference, job_reference, status, amount, amount_paid
--     FROM public.invoices
--    WHERE status IN ('pending','overdue')
--      AND amount_paid >= amount - 0.01
--      AND deleted_at IS NULL;
