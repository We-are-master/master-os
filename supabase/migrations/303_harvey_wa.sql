-- 303 · Harvey no WhatsApp: estado de cada conversa e trava de mensagem repetida
--
-- O Harvey (vendedor da Fixfy) atende quem chega pelo anúncio de WhatsApp,
-- dentro do Zendesk (Sunshine Conversations). A Sunshine reenvia o mesmo
-- evento quando a resposta demora: `harvey_wa_mensagens` guarda o id de cada
-- mensagem já tratada e o insert com conflito é a trava. `harvey_wa_conversas`
-- diz quem está com a conversa (harvey, equipe) e liga ao lead do OS.

create table if not exists public.harvey_wa_conversas (
  conversation_id  text primary key,
  user_id          text,
  phone            text,
  name             text,
  lead_id          uuid references public.site_leads(id) on delete set null,
  estado           text not null default 'harvey' check (estado in ('harvey', 'equipe', 'parado')),
  checkout_ref     text,
  checkout_total   numeric,
  checkout_deposit boolean,
  email            text,
  passou_em        timestamptz,
  motivo_passagem  text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

create table if not exists public.harvey_wa_mensagens (
  message_id       text primary key,
  conversation_id  text not null,
  criado_em        timestamptz not null default now()
);

create index if not exists harvey_wa_conversas_email_idx on public.harvey_wa_conversas (lower(email)) where email is not null;

alter table public.harvey_wa_conversas enable row level security;
alter table public.harvey_wa_mensagens enable row level security;

drop policy if exists "harvey_wa_conversas_staff_read" on public.harvey_wa_conversas;
create policy "harvey_wa_conversas_staff_read" on public.harvey_wa_conversas
  for select to authenticated using (public.is_internal_staff());

grant select on public.harvey_wa_conversas to authenticated;

comment on table public.harvey_wa_conversas is
  'Conversas de WhatsApp atendidas pelo Harvey (Sunshine Conversations): quem está com ela, lead e link de pagamento.';
