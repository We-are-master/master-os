-- 359 · CRM de Leads e Quotes: etapas novas (06/11/2026, dono)
--
-- O funil fica com o mesmo nome no OS e no Zendesk:
--
--   new         New lead     chegou, ninguém qualificou
--   qualifying  Qualifying   Harvey (ou a equipe) juntando os dados
--   qualified   Qualified    dados completos, vez do closer
--   quoting     Quoting      quote em montagem: interna ou bid dos parceiros
--                            (Ready to send = parceiro cotou, falta enviar)
--   quoted      Quoted       o cliente tem o preço (Awaiting approval / deposit)
--   won         Won          job criado
--   lost        Lost         com motivo; com data de volta faz o papel do antigo
--                            Nurture e volta sozinho para New lead no dia
--
-- Remapeia: talking → qualifying; quote_sent e accepted → quoted;
-- nurture → lost (motivo timing, mantém nurture_until).
-- Pode rodar mais de uma vez.

alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads drop constraint if exists leads_nurture_has_date;

update public.leads set stage = 'qualifying' where stage = 'talking';
update public.leads set stage = 'quoted' where stage in ('quote_sent', 'accepted');
update public.leads
   set stage = 'lost',
       lost_reason = coalesce(lost_reason, 'timing'),
       lost_at = coalesce(lost_at, stage_changed_at)
 where stage = 'nurture';

alter table public.leads add constraint leads_stage_check
  check (stage in ('new','qualifying','qualified','quoting','quoted','won','lost'));

comment on column public.leads.stage is
  'Etapa do CRM: new, qualifying, qualified, quoting, quoted, won, lost. Muda pela aplicação, nunca por trigger.';
comment on column public.leads.nurture_until is
  'Lead em Lost com data de volta: no dia ele volta sozinho para New lead.';

-- Lead perdido que volta numa data (ex-Nurture).
create index if not exists leads_volta_idx on public.leads (nurture_until)
  where deleted_at is null and stage = 'lost' and nurture_until is not null;
