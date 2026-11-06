-- 356 · CRM de Leads e Quotes, fase 1 (base)
--
-- A aba Leads vira o CRM de todo pedido, B2C e B2B. A etapa mora no lead e a
-- quote é um documento dentro dele (desenho em docs/crm/). Esta migration só
-- ACRESCENTA: nenhuma coluna sai, a tela de hoje continua igual.
--
--   leads.stage        new, talking, quoting, quote_sent, accepted, won, lost, nurture
--   leads.segment      b2c ou b2b (direct/sem conta = b2c, o resto = b2b)
--   leads.source       canal de origem (lead_channels, o mesmo das quotes)
--   leads.external_*   ticket do Zendesk, mesma convenção de jobs e quotes
--                      (external_source = 'zendesk', external_ref = id do ticket)
--   leads.next_action* próximo passo; a obrigação fica na aplicação (fase 2),
--                      porque os 287 leads de hoje não têm nenhum
--   campos "Ready for job": data e janela desejadas, CCZ, estacionamento,
--                      tipo do job, preço dado no chat
--   quotes.lead_id     a quote pertence a um lead
--   lead_events        timeline do lead (mensagem, etapa, quote, pagamento)
--
-- A etapa NÃO é movida por trigger: quem muda a etapa é a aplicação (mesma
-- regra do sync de quote). O status antigo (new, interested) segue existindo
-- até a tela nova; o serviço de leads grava os dois.

-- ─── leads ───────────────────────────────────────────────────────────────────
alter table public.leads
  add column if not exists stage text not null default 'new',
  add column if not exists stage_changed_at timestamptz not null default now(),
  add column if not exists segment text not null default 'b2c',
  add column if not exists source text references public.lead_channels(key) on update cascade,
  add column if not exists external_source text,
  add column if not exists external_ref text,
  add column if not exists next_action text,
  add column if not exists next_action_at timestamptz,
  add column if not exists last_contact_at timestamptz,
  add column if not exists customer_replied_at timestamptz,
  add column if not exists lost_reason text,
  add column if not exists lost_note text,
  add column if not exists lost_at timestamptz,
  add column if not exists nurture_until date,
  add column if not exists won_at timestamptz,
  add column if not exists job_id uuid references public.jobs(id) on delete set null,
  add column if not exists preferred_date date,
  add column if not exists preferred_window text,
  add column if not exists in_ccz boolean,
  add column if not exists has_free_parking boolean,
  add column if not exists job_kind text,
  add column if not exists price_mode text,
  add column if not exists price_given numeric(10,2);

do $$ begin
  alter table public.leads add constraint leads_stage_check
    check (stage in ('new','talking','quoting','quote_sent','accepted','won','lost','nurture'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.leads add constraint leads_segment_check check (segment in ('b2c','b2b'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.leads add constraint leads_lost_reason_check
    check (lost_reason is null or lost_reason in ('price','went_elsewhere','timing','no_reply','outside_area','not_for_us','duplicate','other'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.leads add constraint leads_job_kind_check
    check (job_kind is null or job_kind in ('one_off','multi_day','recurring'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.leads add constraint leads_price_mode_check
    check (price_mode is null or price_mode in ('fixed','hourly','half_day','daily'));
exception when duplicate_object then null; end $$;

-- Lost tem motivo; Nurture tem data de volta.
do $$ begin
  alter table public.leads add constraint leads_lost_has_reason
    check (stage <> 'lost' or lost_reason is not null) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.leads add constraint leads_nurture_has_date
    check (stage <> 'nurture' or nurture_until is not null) not valid;
exception when duplicate_object then null; end $$;

-- Backfill: a etapa "mudou" quando o lead foi mexido pela última vez, não agora.
update public.leads set stage_changed_at = coalesce(updated_at, created_at);

-- Backfill: interested vira talking; segmento pela conta.
update public.leads set stage = 'talking' where status = 'interested' and stage = 'new';

update public.leads l
   set segment = 'b2b'
  from public.accounts a
 where a.id = l.account_id
   and coalesce(a.process_type, 'direct') <> 'direct'
   and l.segment = 'b2c';

-- Um lead vivo por ticket.
create unique index if not exists leads_ticket_unique
  on public.leads (external_source, external_ref)
  where external_ref is not null and deleted_at is null;

create index if not exists leads_stage_idx on public.leads (stage) where deleted_at is null;
create index if not exists leads_next_action_idx on public.leads (next_action_at)
  where deleted_at is null and stage not in ('won','lost');
create index if not exists leads_job_idx on public.leads (job_id) where job_id is not null;

comment on column public.leads.stage is 'Etapa do CRM. Muda pela aplicação, nunca por trigger.';
comment on column public.leads.external_ref is 'Id do ticket do Zendesk quando external_source = zendesk. Quote e job usam o mesmo ticket.';
comment on column public.leads.next_action_at is 'Próximo passo. Lead aberto sem próximo passo vai para a Fila Today.';

-- ─── quotes ──────────────────────────────────────────────────────────────────
alter table public.quotes
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

create index if not exists quotes_lead_idx on public.quotes (lead_id) where lead_id is not null;

-- ─── lead_events ─────────────────────────────────────────────────────────────
create table if not exists public.lead_events (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads(id) on delete cascade,
  kind            text not null check (kind in (
                    'created','stage_changed','message_in','message_out','note',
                    'next_action_set','quote_created','quote_sent','payment',
                    'assigned','job_created')),
  channel         text check (channel is null or channel in ('zendesk','whatsapp','email','phone','os','portal')),
  actor_type      text not null default 'staff' check (actor_type in ('staff','harvey','system','customer','partner')),
  actor_id        uuid,
  from_stage      text,
  to_stage        text,
  summary         text,
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  created_at      timestamptz not null default now()
);

create index if not exists lead_events_lead_idx on public.lead_events (lead_id, created_at desc);

alter table public.lead_events enable row level security;

drop policy if exists "lead_events_staff" on public.lead_events;
create policy "lead_events_staff" on public.lead_events
  for all to authenticated
  using (public.is_internal_staff())
  with check (public.is_internal_staff());

comment on table public.lead_events is
  'Timeline do lead no CRM: mensagens (Zendesk, WhatsApp, e-mail), mudanças de etapa, quote, pagamento. Quem fez: staff, harvey, system, customer, partner.';
