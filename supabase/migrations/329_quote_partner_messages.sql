-- 329 · Mensagens de parceiro lidas pelo Harvey nas side conversations (dono, 15/10/2026)
--
-- O WHistyle (e outros) respondem o convite de cotação por e-mail, na side
-- conversation do ticket, e o lance nunca virava quote_bids: a cotação parava.
-- O leitor de lances por e-mail (src/lib/lances-por-email.ts) lê essas
-- mensagens, classifica (lance, lance revisado, resposta a pergunta, outra) e
-- grava aqui o id do evento da side conversation: é a trava para nunca ler a
-- mesma mensagem duas vezes.
--
-- A mesma tabela guarda as perguntas que o Harvey fez ao parceiro pelo cliente
-- (ferramenta ask_partner, kind = 'question'), para o get_quote_status contar
-- ao cliente o que o profissional respondeu.
--
-- Só o servidor escreve (service role). Equipe interna lê.

create table if not exists public.quote_partner_messages (
  message_id            text primary key,
  quote_id              uuid not null references public.quotes(id) on delete cascade,
  partner_id            uuid references public.partners(id) on delete set null,
  ticket_id             bigint,
  side_conversation_id  text,
  kind                  text not null check (kind in ('bid', 'revised_bid', 'answer', 'other', 'question')),
  body                  text,
  amount                numeric(12, 2),
  bid_id                uuid,
  created_at            timestamptz not null default now()
);

create index if not exists quote_partner_messages_quote_idx on public.quote_partner_messages (quote_id, created_at desc);

alter table public.quote_partner_messages enable row level security;

drop policy if exists "quote_partner_messages_staff_read" on public.quote_partner_messages;
create policy "quote_partner_messages_staff_read" on public.quote_partner_messages
  for select to authenticated using (public.is_internal_staff());

comment on table public.quote_partner_messages is
  'Mensagens de parceiro nas side conversations que o Harvey já leu (lance, revisão, resposta) e perguntas que ele fez pelo cliente. message_id = id do evento da side conversation (trava de idempotência).';

notify pgrst, 'reload schema';
