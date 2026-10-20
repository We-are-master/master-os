-- 339 · Pergunta do parceiro ao cliente (B3, dono 20/10/2026)
--
-- O parceiro pergunta algo que só o cliente sabe (acesso, medidas, fotos): o Harvey leva a
-- pergunta ao cliente e devolve a resposta ao parceiro (src/lib/harvey/ponte-cliente-parceiro.ts).
--   partner_question         = a mensagem do parceiro que virou pergunta ao cliente
--   partner_question_relayed = a resposta do cliente que já voltou ao parceiro (trava)
--   customer_reply           = resposta do cliente a uma cotação enviada, já lida pelo aceite escrito (trava)

alter table public.quote_partner_messages drop constraint if exists quote_partner_messages_kind_check;
alter table public.quote_partner_messages add constraint quote_partner_messages_kind_check
  check (kind in ('bid', 'revised_bid', 'answer', 'other', 'question', 'partner_question', 'partner_question_relayed', 'customer_reply'));

notify pgrst, 'reload schema';
