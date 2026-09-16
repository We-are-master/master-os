-- ─────────────────────────────────────────────────────────────────────────────
-- Marketing: a lista de bloqueio ÚNICA, e o registro de toque por contato.
--
-- O problema que isto resolve: hoje quem clica em "unsubscribe" sai das
-- sequências (`email_sequence_enrollments`) e vira `unsubscribed` em `leads`,
-- mas continua alcançável em `clients`. Ou seja, sai de uma camada e recebe
-- pela outra — que é exatamente como se ganha marcação de spam e se queima o
-- domínio que também manda confirmação de job e cobrança.
--
-- `email_suppressions` passa a ser a única fonte da verdade: chave é o e-mail
-- em minúsculas, e TODA camada de envio consulta antes de mandar qualquer
-- coisa de marketing. Transacional (job, fatura, parceiro) NÃO consulta: um
-- cliente que não quer promoção continua tendo que receber a confirmação da
-- visita que ele marcou.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.email_suppressions (
  email       text        primary key,
  reason      text        not null
                check (reason in ('unsubscribed','complained','bounced','manual','invalid')),
  source      text,                                  -- campanha/sequência que originou
  notes       text,
  created_at  timestamptz not null default now()
);

comment on table public.email_suppressions is
  'Lista de bloqueio de marketing. Consultada por TODA camada de envio promocional; nunca pelo transacional.';
comment on column public.email_suppressions.reason is
  'unsubscribed = pediu para sair · complained = marcou spam · bounced = rejeição permanente · manual = decisão nossa · invalid = endereço inexistente';

-- ─── Toque por contato: o histórico que aparece no card do cliente ───────────
-- Uma linha por e-mail/WhatsApp de marketing enviado. Append-only. É o que
-- alimenta o painel e a tirinha de "último contato" na tela do cliente.
create table if not exists public.marketing_touches (
  id            uuid        primary key default gen_random_uuid(),
  email         text,                                -- minúsculas; nulo quando o canal é whatsapp puro
  phone         text,
  client_id     uuid        references public.clients(id) on delete set null,
  campaign      text        not null,                -- 'b2c_setembro_01', 'b2b_agencias_dia1', …
  channel       text        not null default 'email'
                  check (channel in ('email','whatsapp','linkedin','phone')),
  segment       text,                                -- 'b2b' | 'b2c' | 'phone_only'
  subject       text,
  provider_id   text,                                -- id do Resend, para casar o webhook
  sent_at       timestamptz not null default now(),
  delivered_at  timestamptz,
  opened_at     timestamptz,
  clicked_at    timestamptz,
  bounced_at    timestamptz,
  complained_at timestamptz,
  replied_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists marketing_touches_email_idx     on public.marketing_touches (lower(email));
create index if not exists marketing_touches_client_idx    on public.marketing_touches (client_id, sent_at desc);
create index if not exists marketing_touches_campaign_idx  on public.marketing_touches (campaign, sent_at desc);
create index if not exists marketing_touches_provider_idx  on public.marketing_touches (provider_id)
  where provider_id is not null;

comment on table public.marketing_touches is
  'Um toque de marketing enviado. Append-only: o webhook do Resend só carimba as datas de entrega, abertura e rejeição.';

-- ─── Resumo por campanha, para o painel não somar 90 mil linhas a cada carga ──
create or replace view public.marketing_campaign_stats as
select
  campaign,
  channel,
  min(sent_at)                                            as first_sent_at,
  max(sent_at)                                            as last_sent_at,
  count(*)                                                as sent,
  count(*) filter (where delivered_at  is not null)       as delivered,
  count(*) filter (where opened_at     is not null)       as opened,
  count(*) filter (where clicked_at    is not null)       as clicked,
  count(*) filter (where replied_at    is not null)       as replied,
  count(*) filter (where bounced_at    is not null)       as bounced,
  count(*) filter (where complained_at is not null)       as complained
from public.marketing_touches
group by campaign, channel;

comment on view public.marketing_campaign_stats is
  'Funil por campanha. É a fonte do painel de marketing no OS.';
