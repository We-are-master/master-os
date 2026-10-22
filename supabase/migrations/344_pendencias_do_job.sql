-- =============================================================================
-- Migration 344: pendências do job (Action Required com motivo) · 22/10/2026
-- =============================================================================
--
-- Plano do dono (22/10/2026), item 2: Action Required é uma fila de pendências
-- com motivo explícito, sem mexer no estado operacional (jobs.status) nem no
-- financeiro (finance_status). Até aqui era um filtro de tela sem motivo, e um
-- job com parceiro e sem data sumia da fila.
--
-- Um motivo aberto por job e tipo (índice parcial). Resolver = preencher
-- resolved_at; abrir de novo = linha nova. O cálculo mora em
-- src/lib/pendencias/motivos.ts.
--
-- Motivos: date_tbc, partner_required, deposit_pending, card_declined,
-- payment_unsuccessful, report_incomplete, human_review_required, price_missing,
-- partner_cost_missing, job_creation_failed.
--
-- A view job_financial_state junta o que hoje está espalhado (finance_status,
-- cartão, sinal) sem enum novo.
-- Nenhuma linha é criada aqui: a tabela nasce vazia.
-- Idempotente.

create table if not exists public.job_attention_reasons (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  reason text not null check (reason in (
    'date_tbc', 'partner_required', 'deposit_pending', 'card_declined', 'payment_unsuccessful',
    'report_incomplete', 'human_review_required', 'price_missing', 'partner_cost_missing', 'job_creation_failed'
  )),
  detail text,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  opened_by text not null default 'system',
  resolved_by text
);

create unique index if not exists job_attention_reasons_um_aberto
  on public.job_attention_reasons (job_id, reason) where resolved_at is null;
create index if not exists job_attention_reasons_abertos
  on public.job_attention_reasons (opened_at) where resolved_at is null;

alter table public.job_attention_reasons enable row level security;
drop policy if exists "job_attention_reasons_staff_read" on public.job_attention_reasons;
create policy "job_attention_reasons_staff_read" on public.job_attention_reasons
  for select to authenticated using (public.is_internal_staff());

create or replace view public.job_financial_state as
select
  j.id as job_id,
  coalesce(j.finance_status, j.payment_status, 'unpaid') as finance_status,
  j.card_charge_status,
  coalesce(j.customer_deposit, 0) as deposit_amount,
  coalesce(j.customer_deposit_paid, false) as deposit_paid,
  case
    when coalesce(j.finance_status, j.payment_status) = 'paid' then 'paid'
    when j.status = 'awaiting_payment' and j.card_charge_status in ('refused', 'requires_action') then 'card_declined'
    when j.status = 'awaiting_payment' then 'awaiting_payment'
    when coalesce(j.customer_deposit, 0) > 0 and not coalesce(j.customer_deposit_paid, false) then 'deposit_pending'
    when coalesce(j.finance_status, j.payment_status) = 'partial' then 'balance_pending'
    else 'unpaid'
  end as financial_state
from public.jobs j
where j.deleted_at is null;

comment on table public.job_attention_reasons is 'Pendências do job com motivo explícito (Action Required). Migration 344.';
