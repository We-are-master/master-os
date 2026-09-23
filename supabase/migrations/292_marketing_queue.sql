-- Fila de campanha (23/09/2026, campanha WEEK10).
--
-- Uma linha por mensagem PLANEJADA, montada de uma vez antes do disparo. É o
-- que deixa o painel mostrar "falta mandar 1.212" e o que permite o follow-up
-- de WhatsApp nascer 4 horas depois do e-mail daquela pessoa, e não de um
-- horário fixo. O que foi de fato enviado continua em marketing_touches: a
-- fila é o plano, o toque é o fato.

create table if not exists public.marketing_queue (
  id              uuid        primary key default gen_random_uuid(),
  campanha        text        not null,
  client_id       uuid        references public.clients(id) on delete set null,
  grupo           text        not null check (grupo in ('os_dois','so_numero','so_email','teste')),
  canal           text        not null check (canal in ('email','whatsapp')),
  passo           text        not null,                 -- email_quente | wa_followup | wa_oferta | email_oferta | email_lembrete
  email           text,
  phone           text,                                 -- só dígitos, com país
  primeiro_nome   text        not null default 'there',
  agendado_para   timestamptz,                          -- nulo = espera outro passo (o follow-up espera o e-mail)
  status          text        not null default 'planejado'
                    check (status in ('planejado','reservado','enviado','falhou','pulado')),
  reservado_em    timestamptz,
  enviado_em      timestamptz,
  provider_id     text,                                 -- id do Resend ou wamid da Meta
  erro            text,
  custo_estimado  numeric(10,5),                        -- em libras
  criado_em       timestamptz not null default now()
);

create unique index if not exists marketing_queue_um_por_passo
  on public.marketing_queue (campanha, passo, client_id);

create index if not exists marketing_queue_vencidos
  on public.marketing_queue (campanha, canal, agendado_para)
  where status = 'planejado';

create index if not exists marketing_queue_provider
  on public.marketing_queue (provider_id)
  where provider_id is not null;

alter table public.marketing_queue enable row level security;

comment on table public.marketing_queue is
  'Plano de uma campanha: uma linha por mensagem. O fato do envio fica em marketing_touches.';
