-- 305 · Cancelamento pelo parceiro, com a penalidade calculada na hora
--
-- O parceiro cancela no portal; o job volta para a oferta na hora e fica
-- aqui o registro, com a penalidade pela regra em vigor:
--   v1 (contrato de 22/09/2026): £50 se faltar menos de 24h
--   v2 (proposta de 29/09/2026, depende do contador e do contrato v2):
--      50% do repasse se faltar menos de 36h
-- A equipe aprova ou isenta (doença, emergência). Aprovada, entra como dedução
-- nomeada na self-bill da quinzena.

create table if not exists public.partner_cancellations (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs(id) on delete cascade,
  partner_id      uuid not null references public.partners(id) on delete cascade,
  cancelled_at    timestamptz not null default now(),
  hours_before    numeric,
  partner_pay     numeric,
  penalty_amount  numeric not null default 0,
  rule            text not null check (rule in ('v1_50gbp_24h', 'v2_50pct_36h')),
  reason          text,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'waived')),
  decision_note   text,
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  self_bill_id    uuid,
  created_at      timestamptz not null default now()
);

create index if not exists partner_cancellations_partner_idx on public.partner_cancellations (partner_id, cancelled_at desc);
create index if not exists partner_cancellations_pending_idx on public.partner_cancellations (status) where status = 'pending';

alter table public.partner_cancellations enable row level security;

drop policy if exists "partner_cancellations_staff_all" on public.partner_cancellations;
create policy "partner_cancellations_staff_all" on public.partner_cancellations
  for all to authenticated
  using (public.is_internal_staff())
  with check (public.is_internal_staff());

grant select, update on public.partner_cancellations to authenticated;

comment on table public.partner_cancellations is
  'Parceiro cancelou um job que era dele: horas antes, repasse, penalidade pela regra (v1 £50/24h, v2 50%/36h) e a decisão da equipe.';
