-- Migration 267: o rótulo do self-bill passa a dizer o período, não a semana
--
-- Depois da 265, os self-bills consolidados ganharam rótulo de período
-- ("2026-08-03 a 2026-08-16") e os que já eram documento único ficaram com o
-- antigo ("2026-W33"). Os dois cobrem a mesma quinzena e pagam no mesmo dia,
-- então a lista mostra dois formatos para a mesma coisa.
--
-- `2026-W33` sempre mentiu um pouco: diz semana num documento que cobre duas.
--
-- Só mexe em documento ABERTO. Self-bill pago é o que o parceiro recebeu, com o
-- rótulo que estava no PDF dele, e reescrever isso seria reescrever história.

UPDATE public.self_bills
   SET week_label = to_char((due_date - INTERVAL '18 days')::date, 'YYYY-MM-DD')
                    || ' a ' || to_char((due_date - INTERVAL '5 days')::date, 'YYYY-MM-DD')
 WHERE bill_origin = 'partner'
   AND due_date IS NOT NULL
   AND status IN ('accumulating', 'ready_to_pay', 'awaiting_payment', 'pending_review')
   AND week_label ~ '^[0-9]{4}-W[0-9]{2}$';

-- Confere: nenhum aberto com rótulo de semana.
--   SELECT reference, week_label, due_date FROM public.self_bills
--    WHERE bill_origin='partner' AND week_label ~ '^[0-9]{4}-W[0-9]{2}$'
--      AND status IN ('accumulating','ready_to_pay','awaiting_payment','pending_review');
