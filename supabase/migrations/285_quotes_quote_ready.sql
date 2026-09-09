-- 285 — Quote Ready: o preço está pronto e ninguém enviou ainda.
--
-- Faltava um estado entre "os lances chegaram" e "mandei pro cliente". Sem ele
-- a quote com lance recebido e rascunho pronto fica em `bidding`, e isso é
-- mentira: o leilão acabou. `awaiting_customer` também seria mentira, porque o
-- cliente não recebeu nada.
--
-- Já houve uma tentativa disso como bucket calculado (`isQuoteReadyToSend`,
-- hoje deprecated): a quote continuava em `draft` e quatro condições decidiam
-- se ela "estava pronta". Estado espalhado em condição é estado que diverge, e
-- a aba foi removida. Aqui vira campo: uma pergunta, uma resposta.
--
-- Quem escreve é o Harvey, ao pôr o rascunho de preço na thread do ticket.
-- Quem tira é o envio ao cliente, que já move para `awaiting_customer`.

alter table public.quotes
  drop constraint if exists quotes_status_check;

alter table public.quotes
  add constraint quotes_status_check check (status = any (array[
    'draft'::text,
    'in_survey'::text,
    'bidding'::text,
    'quote_ready'::text,
    'awaiting_customer'::text,
    'awaiting_payment'::text,
    'rejected'::text,
    'converted_to_job'::text
  ]));

comment on column public.quotes.status is
  'Ciclo da quote. `quote_ready` = lances recebidos, preço calculado e rascunho pronto na thread; ninguém enviou ao cliente ainda. Sai daqui pelo envio, que move para awaiting_customer.';
