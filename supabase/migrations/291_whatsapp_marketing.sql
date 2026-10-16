-- Disparo de WhatsApp de marketing (23/09/2026).
--
-- A lista de bloqueio do e-mail é por endereço; o WhatsApp precisa da sua,
-- por número, porque metade da base não tem e-mail. Quem toca "Stop
-- promotions" ou responde STOP entra aqui pelo webhook e nunca mais recebe
-- campanha. Mensagem de serviço (confirmação, véspera) NUNCA consulta esta
-- tabela: quem recusa promoção continua sabendo a hora da visita.

create table if not exists public.whatsapp_suppressions (
  phone       text        primary key,              -- só dígitos, com país (447…)
  reason      text        not null
                check (reason in ('stopped','blocked','invalid','manual')),
  source      text,                                  -- campanha que originou
  notes       text,
  created_at  timestamptz not null default now()
);

comment on table public.whatsapp_suppressions is
  'Lista de bloqueio de WhatsApp de marketing. stopped = pediu para sair · blocked = bloqueou/denunciou · invalid = número sem WhatsApp · manual = decisão nossa.';

alter table public.whatsapp_suppressions enable row level security;

-- Uma mensagem por número por campanha, garantido pelo banco e não pela
-- memória do cron: duas voltas simultâneas não mandam duas vezes.
create unique index if not exists marketing_touches_wa_once
  on public.marketing_touches (campaign, phone)
  where channel = 'whatsapp';

create index if not exists marketing_touches_phone_idx
  on public.marketing_touches (phone, sent_at desc)
  where phone is not null;
