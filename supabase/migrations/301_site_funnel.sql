-- Funil do /book sem cookie: um evento por passo por visita, anônimo.
--
-- O pixel da Meta só liga com o sim de marketing no banner, então a Meta vê
-- uns 12% de quem entra (25/09/2026: 214 cliques, 26 "landing page views").
-- Aqui entra todo mundo, sem dado pessoal: `visit_id` é um número aleatório
-- que vive só na memória da página (nada gravado no aparelho, some ao
-- recarregar), e as etiquetas são as do próprio link do anúncio (utm_*).
-- Sem IP, sem navegador, sem e-mail.
--
-- Quem lê: a Online Room do office (funil por anúncio). Pago continua vindo
-- de site_leads.won_at.

create table if not exists public.site_funnel_events (
  id           bigint generated always as identity primary key,
  visit_id     uuid not null,
  event        text not null check (event in ('landing', 'book_1', 'book_2', 'book_3', 'book_4')),
  services     text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_content  text,
  landing      text,
  created_at   timestamptz not null default now(),
  unique (visit_id, event)
);

create index if not exists site_funnel_events_created_idx on public.site_funnel_events (created_at desc);
create index if not exists site_funnel_events_campaign_idx on public.site_funnel_events (utm_campaign, utm_content, created_at desc);

alter table public.site_funnel_events enable row level security;

drop policy if exists "site_funnel_events_staff_read" on public.site_funnel_events;
create policy "site_funnel_events_staff_read"
  on public.site_funnel_events for select to authenticated
  using (public.is_internal_staff());

grant select on public.site_funnel_events to authenticated;

comment on table public.site_funnel_events is
  'Funil anônimo do site (sem cookie): landing e passos 1 a 4 do /book, um por visita. Grava só pelo /api/site-leads (event funnel).';
