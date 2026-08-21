-- Migration 268: um status só para "fechado, esperando o dia"
--
-- `awaiting_payment` e `ready_to_pay` significam a mesma coisa, e o código já
-- os trata como equivalentes em oito lugares diferentes, todos escritos assim:
--
--     s.status === "awaiting_payment" || s.status === "ready_to_pay"
--
-- Quando toda leitura precisa de um OR para não errar, os dois valores são um
-- valor só com dois nomes. Medido em 20/08/2026: 10 em `awaiting_payment` e 6
-- em `ready_to_pay`, sem nenhuma regra que os distinga.
--
-- `ready_to_pay` é o que fica: diz o que a pessoa precisa saber (pode pagar),
-- enquanto `awaiting_payment` descreve a espera, que é o estado de todo
-- documento que ainda não foi pago e portanto não informa nada.
--
-- Os ORs no código FICAM. Eles viram redundância inofensiva e protegem contra
-- um ambiente que ainda tenha o valor antigo. Tirá-los é mexer em oito telas de
-- uma vez, e isso merece ser feito com alguém olhando as telas.

UPDATE public.self_bills
   SET status = 'ready_to_pay'
 WHERE status = 'awaiting_payment';

-- Confere: nenhum self-bill em `awaiting_payment`.
--   SELECT status, count(*) FROM public.self_bills GROUP BY status ORDER BY 2 DESC;
