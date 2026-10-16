-- Fase 0 (dono, 09/10/2026): B2C e quem não tem conta pagam 50% antes e 50% no fim
-- no cartão salvo. O cartão fica na Stripe; aqui só guardamos os ids e o que mostrar
-- na tela (bandeira e final). Cartão recusado no final review: o job fica em final check
-- com "Card refused" e novas tentativas só nas recusas que a bandeira permite.

alter table public.clients
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_default_payment_method_id text,
  add column if not exists card_brand text,
  add column if not exists card_last4 text,
  add column if not exists card_saved_at timestamptz,
  add column if not exists card_consent_version text;

alter table public.jobs
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists card_charge_status text not null default 'none',
  add column if not exists card_charge_hold boolean not null default false,
  add column if not exists card_refused_reason text,
  add column if not exists card_retry_at timestamptz,
  add column if not exists card_retry_count integer not null default 0;

do $$ begin
  alter table public.jobs add constraint jobs_card_charge_status_check
    check (card_charge_status in ('none', 'saved', 'charged', 'refused', 'requires_action', 'skipped'));
exception when duplicate_object then null; end $$;

comment on column public.jobs.card_charge_status is
  'none = sem cartão; saved = cartão salvo no sinal; charged = restante cobrado; refused = recusado (fica em final check); requires_action = banco pediu confirmação, só pelo link; skipped = cobrança segurada/pulada.';

-- Cada tentativa de cobrança, com a chave que impede cobrar duas vezes.
create table if not exists public.stripe_charge_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind text not null check (kind in ('balance', 'extra', 'cancel_fee')),
  amount_pence integer not null check (amount_pence > 0),
  idempotency_key text not null unique,
  payment_intent_id text,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'requires_action')),
  error_code text,
  decline_code text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_charge_attempts_job_idx on public.stripe_charge_attempts (job_id, created_at desc);
create index if not exists jobs_card_retry_idx on public.jobs (card_retry_at) where card_charge_status = 'refused';

alter table public.stripe_charge_attempts enable row level security;
