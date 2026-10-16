-- 294 · Leads do site (reserva abandonada)
--
-- Quem começa a reservar em getfixfy.com e não paga. Nasce no passo 1 (nome e
-- e-mail), é atualizado a cada passo, recebe os três e-mails de retomada e sai
-- daqui quando paga (vira cliente com job). Tudo que acontece com ele fica em
-- site_lead_activity, que é a linha do tempo da aba Leads.
--
-- Não confundir com public.leads (196): aquela é a lista de jobs oferecidos a
-- parceiros, outra coisa, e continua como está.

create table if not exists public.site_leads (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  email            text not null,
  full_name        text,
  phone            text,
  postcode         text,
  client_id        uuid references public.clients(id) on delete set null,

  -- O que a pessoa escolheu, como o site manda (serviço, tipo, tamanho...).
  selection        jsonb not null default '{}'::jsonb,
  service_label    text,
  price            numeric(10,2),
  resume_url       text,
  source           jsonb not null default '{}'::jsonb,

  step_reached     smallint not null default 1 check (step_reached between 1 and 4),
  last_activity_at timestamptz not null default now(),

  status           text not null default 'new'
                   check (status in ('new', 'hot', 'contacted', 'won', 'lost', 'unsubscribed')),
  lost_reason      text,
  marketing_opt_out boolean not null default false,

  -- Sequência de retomada: horários calculados pelo OS (agendaDoAbandono)
  -- a partir de last_activity_at, e o que já saiu.
  sequence_state   text not null default 'scheduled'
                   check (sequence_state in ('scheduled', 'paused', 'stopped', 'done')),
  email1_due_at    timestamptz,
  email2_due_at    timestamptz,
  email3_due_at    timestamptz,
  email1_sent_at   timestamptz,
  email2_sent_at   timestamptz,
  email3_sent_at   timestamptz,
  promo_code       text,
  promo_id         text,
  promo_expires_at timestamptz,

  -- Quando paga.
  won_at           timestamptz,
  job_id           uuid references public.jobs(id) on delete set null,
  booking_ref      text
);

-- Um lead aberto por e-mail: voltar e recomeçar atualiza o mesmo.
create unique index if not exists site_leads_open_email_uidx
  on public.site_leads (lower(email))
  where status in ('new', 'hot', 'contacted');

create index if not exists site_leads_due_idx
  on public.site_leads (sequence_state, email1_due_at, email2_due_at, email3_due_at)
  where sequence_state = 'scheduled';

create index if not exists site_leads_status_idx
  on public.site_leads (status, last_activity_at desc);

create table if not exists public.site_lead_activity (
  id        uuid primary key default gen_random_uuid(),
  lead_id   uuid not null references public.site_leads(id) on delete cascade,
  at        timestamptz not null default now(),
  -- step · email_sent · email_skipped · whatsapp · note · status · paid
  kind      text not null,
  detail    text,
  meta      jsonb not null default '{}'::jsonb,
  -- Resend id quando é e-mail: aberto e clicado vêm de marketing_touches.
  provider_id text,
  actor_id  uuid references public.profiles(id) on delete set null
);

create index if not exists site_lead_activity_lead_idx
  on public.site_lead_activity (lead_id, at desc);

alter table public.site_leads enable row level security;
alter table public.site_lead_activity enable row level security;

drop policy if exists "site_leads_staff_all" on public.site_leads;
create policy "site_leads_staff_all"
  on public.site_leads for all to authenticated
  using (public.is_internal_staff())
  with check (public.is_internal_staff());

drop policy if exists "site_lead_activity_staff_all" on public.site_lead_activity;
create policy "site_lead_activity_staff_all"
  on public.site_lead_activity for all to authenticated
  using (public.is_internal_staff())
  with check (public.is_internal_staff());

grant select, insert, update on public.site_leads to authenticated;
grant select, insert on public.site_lead_activity to authenticated;

comment on table public.site_leads is
  'Quem começou a reservar no site e não pagou. status: new → hot (passo 3+) → contacted → won | lost | unsubscribed.';
comment on table public.site_lead_activity is
  'Linha do tempo do lead do site: passos, e-mails, mensagens, notas e mudanças de estado.';
