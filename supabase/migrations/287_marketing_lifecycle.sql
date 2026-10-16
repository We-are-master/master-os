-- ─────────────────────────────────────────────────────────────────────────────
-- O funil de sempre: o que faltava no banco para ele rodar.
--
-- A 241 criou as tabelas do motor de sequências, mas nunca chegou a rodar em
-- produção: em 22/09/2026 `email_sequence_enrollments` não existia no banco,
-- e por isso o motor era código morto desde julho. Esta migration é idempotente
-- de propósito, então ela cria o que faltar e não reclama do que já existe.
--
-- O que muda além de garantir as tabelas:
--
--   client_id   a inscrição passa a saber de qual cliente do OS ela é. Sem
--               isso o toque de marketing não aparece no card da pessoa, e a
--               varredura não consegue voltar do e-mail para o cliente.
--   índices     a varredura conta inscrições das últimas 24h (teto de
--               aquecimento) e o motor lê os toques recentes (trava do
--               descanso). São as duas consultas quentes do funil.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.email_sequence_enrollments (
  id            uuid primary key default gen_random_uuid(),
  sequence_key  text        not null,
  contact_email text        not null,
  contact_name  text,
  status        text        not null default 'active'
                  check (status in ('active','completed','converted','stopped')),
  current_step  int         not null default 0,
  cycle         int         not null default 0,
  context       jsonb       not null default '{}'::jsonb,
  enrolled_at   timestamptz not null default now(),
  next_send_at  timestamptz not null default now(),
  last_sent_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists email_seq_one_active
  on public.email_sequence_enrollments (sequence_key, contact_email)
  where status = 'active';

create index if not exists email_seq_due
  on public.email_sequence_enrollments (next_send_at)
  where status = 'active';

create table if not exists public.email_sequence_sends (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.email_sequence_enrollments(id) on delete cascade,
  sequence_key  text not null,
  step_key      text not null,
  step_index    int  not null,
  contact_email text not null,
  subject       text,
  resend_id     text,
  cycle         int  not null default 0,
  sent_at       timestamptz not null default now()
);

create unique index if not exists email_seq_send_once
  on public.email_sequence_sends (enrollment_id, step_index, cycle);

alter table public.email_sequence_enrollments enable row level security;
alter table public.email_sequence_sends       enable row level security;

-- ─── O que a 287 acrescenta ──────────────────────────────────────────────────

alter table public.email_sequence_enrollments
  add column if not exists client_id uuid references public.clients(id) on delete set null;

create index if not exists email_seq_client_idx
  on public.email_sequence_enrollments (client_id)
  where client_id is not null;

-- Teto de aquecimento: "quantas inscrições nasceram nas últimas 24 horas?".
create index if not exists email_seq_created_idx
  on public.email_sequence_enrollments (created_at desc);

-- Trava do descanso: "quem recebeu marketing nas últimas 20 horas?".
create index if not exists marketing_touches_sent_idx
  on public.marketing_touches (sent_at desc);

comment on column public.email_sequence_enrollments.client_id is
  'Cliente do OS por trás da inscrição. Nulo em lead frio, que ainda não virou cliente.';
comment on table public.email_sequence_enrollments is
  'Inscrição de um contato numa sequência. Uma ativa por (sequência, e-mail); o cron anda os passos e as que giram somam ciclo.';
