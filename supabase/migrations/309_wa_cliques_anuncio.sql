-- 309 · Clique no anúncio de WhatsApp e os eventos de conversa mandados à Meta
--
-- Quem chega por um anúncio de WhatsApp traz, na primeira mensagem, o id do
-- clique (`referral.ctwa_clid`). O webhook da Cloud API guarda aqui, pelo
-- telefone. Quando o Harvey cota, manda o link ou o sinal é pago, o OS manda
-- o evento à Meta (Conversions API, canal business_messaging) com esse id, e
-- a venda aparece no anúncio certo. `meta_eventos_wa` é a trava: um evento
-- por (evento, event_id), então reenvio e retry não contam duas vezes.
--
-- (307 e 308 estão reservadas pela branch feat/harvey-wa-parceiro-cliente.)

create table if not exists public.wa_cliques_anuncio (
  id           bigserial primary key,
  phone        text not null,            -- só dígitos, como o WhatsApp manda (447...)
  ctwa_clid    text not null,
  ad_id        text,                     -- referral.source_id
  headline     text,
  source_url   text,
  message_id   text unique,              -- a mensagem que trouxe o clique (a Meta reenvia webhook)
  recebido_em  timestamptz not null default now()
);

create index if not exists wa_cliques_anuncio_phone_idx on public.wa_cliques_anuncio (phone, recebido_em desc);

create table if not exists public.meta_eventos_wa (
  id           bigserial primary key,
  evento       text not null check (evento in ('LeadSubmitted', 'InitiateCheckout', 'Purchase')),
  event_id     text not null,
  phone        text not null,
  ctwa_clid    text not null,
  valor        numeric(10, 2),
  status       text not null default 'enviando' check (status in ('enviando', 'enviado', 'falhou')),
  resposta     jsonb,
  criado_em    timestamptz not null default now(),
  unique (evento, event_id)
);

alter table public.wa_cliques_anuncio enable row level security;
alter table public.meta_eventos_wa enable row level security;

drop policy if exists "wa_cliques_anuncio_staff_read" on public.wa_cliques_anuncio;
create policy "wa_cliques_anuncio_staff_read" on public.wa_cliques_anuncio
  for select to authenticated using (public.is_internal_staff());

drop policy if exists "meta_eventos_wa_staff_read" on public.meta_eventos_wa;
create policy "meta_eventos_wa_staff_read" on public.meta_eventos_wa
  for select to authenticated using (public.is_internal_staff());
