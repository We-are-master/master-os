-- Migration 270: alinha week_start/week_end com o período, não com a semana
--
-- Conserto de um erro meu na 267. Ela reescreveu `week_label` para o intervalo
-- do período e **não** mexeu em `week_start` / `week_end`, que continuaram sendo
-- a semana ISO. Resultado medido depois de rodar: seis self-bills abertos com
-- rótulo dizendo "2026-08-17 a 2026-08-30" e limites dizendo 17 a 23 de agosto.
--
-- Os consolidados pela 265 saíram certos porque aquela migração recalculava os
-- dois. Os que já eram documento único ficaram com a contradição.
--
-- Apareceu quando o assunto do email passou a usar `week_start`/`week_end` em
-- vez do rótulo: o email de um documento anunciava sete dias de trabalho num
-- pagamento de catorze.
--
-- Mesma aritmética da 265 e do `workPeriodBoundsForPayoutFriday` no código:
-- a sexta do pagamento menos 5 dias é o domingo do corte, menos 13 é o início.
--
-- SEM condição de "só onde está diferente": a primeira versão comparava
-- `week_start IS DISTINCT FROM (…)::date`, e se `week_start` for `text` neste
-- banco a comparação derruba a query inteira, que foi o que aconteceu.
-- Reescrever o mesmo valor é inofensivo, então a condição não fazia falta.
--
-- Só documento ABERTO e com data de pagamento. Self-bill pago guarda os limites
-- que estavam no PDF que o parceiro recebeu.

UPDATE public.self_bills
   SET week_start = (due_date - INTERVAL '18 days')::date,
       week_end   = (due_date - INTERVAL '5 days')::date
 WHERE bill_origin = 'partner'
   AND due_date IS NOT NULL
   AND status IN ('accumulating', 'ready_to_pay', 'awaiting_payment', 'pending_review');

-- Confere: todo aberto com 14 dias, e rótulo batendo com os limites.
--   SELECT reference, week_label, week_start, week_end,
--          (week_end - week_start) + 1 AS dias
--     FROM public.self_bills
--    WHERE bill_origin='partner' AND due_date IS NOT NULL
--      AND status IN ('accumulating','ready_to_pay','awaiting_payment','pending_review')
--    ORDER BY due_date;
