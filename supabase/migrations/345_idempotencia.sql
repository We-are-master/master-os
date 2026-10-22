-- =============================================================================
-- Migration 345: idempotência de eventos e envios · 22/10/2026
-- =============================================================================
--
-- Plano do dono (22/10/2026), item 3. Duas tabelas que qualquer automação usa
-- antes de agir:
--
--   processed_events   um evento de fora (webhook da Stripe, mensagem da
--                      Sunshine, e-mail) só é processado uma vez: insere a chave
--                      (provider, event_id); conflito = já processado.
--
--   outbound_messages  uma mensagem só sai uma vez: RESERVA a chave antes de
--                      mandar (status reserved), marca sent depois. Falhou ao
--                      mandar = failed e libera. É o que faltou na régua de
--                      leads de 15 a 20/10/2026 (marca depois do envio repetiu
--                      o WhatsApp de 10 em 10 minutos).
--
-- Nenhuma automação é ligada aqui; o código passa a usar as tabelas peça por peça.
-- Idempotente.

create table if not exists public.processed_events (
  provider text not null,
  event_id text not null,
  kind text,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table if not exists public.outbound_messages (
  dedupe_key text primary key,
  purpose text not null,
  channel text not null check (channel in ('email', 'whatsapp', 'zendesk_note', 'sms')),
  job_id uuid references public.jobs(id) on delete set null,
  quote_id uuid,
  zendesk_ticket_id bigint,
  recipient text,
  template text,
  status text not null default 'reserved' check (status in ('reserved', 'sent', 'failed')),
  reason text,
  provider_id text,
  error text,
  reserved_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists outbound_messages_job on public.outbound_messages (job_id) where job_id is not null;
create index if not exists outbound_messages_purpose on public.outbound_messages (purpose, reserved_at);

alter table public.processed_events enable row level security;
alter table public.outbound_messages enable row level security;
drop policy if exists "outbound_messages_staff_read" on public.outbound_messages;
create policy "outbound_messages_staff_read" on public.outbound_messages
  for select to authenticated using (public.is_internal_staff());

comment on table public.processed_events is 'Evento externo processado uma vez (provider + event_id). Migration 345.';
comment on table public.outbound_messages is 'Mensagem enviada uma vez: reservar a chave antes de mandar. Migration 345.';
