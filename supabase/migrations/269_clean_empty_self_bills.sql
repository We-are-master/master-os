-- Migration 269: tira as cascas vazias de self-bill
--
-- Sobraram quatro documentos `accumulating` com £0 e **sem data de pagamento**,
-- que a consolidação da 265 não tocou de propósito (sem data não há período, e
-- adivinhar seria juntar quinzenas diferentes). Medidos em 20/08/2026:
--
--   LandLord Certificate   2026-W34   £0
--   LandLord Certificate   2026-W35   £0
--   ATS Maintenance        2026-W34   £0
--   WHistyle Service       2026-W49   £0   ← semanal, e W49 é dezembro
--
-- São cascas: nasceram quando um job foi vinculado e ficaram sem valor porque
-- nenhum job aprovado entrou. Enquanto existirem, aparecem na lista de "a pagar"
-- somando zero, que é ruído puro na única tela onde o dinheiro sai.
--
-- ARQUIVA, não apaga. Se um job ainda apontar para uma delas, o vínculo
-- continua legível; apagar deixaria `jobs.self_bill_id` apontando para o nada.
--
-- A trava é estreita de propósito: só `accumulating`, só £0, só sem data, só
-- `partner`. Qualquer documento com um centavo dentro fica onde está.

UPDATE public.self_bills
   SET status = 'payout_archived'
 WHERE bill_origin = 'partner'
   AND status      = 'accumulating'
   AND due_date   IS NULL
   AND COALESCE(net_payout, 0) = 0
   AND COALESCE(jobs_count, 0) = 0;

-- Confere: nenhuma casca sobrando.
--   SELECT reference, partner_name, week_label, status, net_payout
--     FROM public.self_bills
--    WHERE bill_origin='partner' AND status='accumulating'
--      AND due_date IS NULL AND COALESCE(net_payout,0)=0;
