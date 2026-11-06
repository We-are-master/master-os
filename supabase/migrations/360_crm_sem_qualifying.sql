-- 360 · CRM: a coluna Qualifying sai do funil (06/11/2026, dono)
--
-- O funil fica: New lead → Qualified → Quoting → Quoted → Won | Lost.
-- Quem estava em Qualifying (juntando os dados) ainda não foi qualificado:
-- volta para New lead. Roda depois da 359. Pode rodar mais de uma vez.

alter table public.leads drop constraint if exists leads_stage_check;

update public.leads
   set stage = 'new',
       status = 'new',
       stage_changed_at = now(),
       updated_at = now()
 where stage in ('qualifying', 'talking');

alter table public.leads add constraint leads_stage_check
  check (stage in ('new','qualified','quoting','quoted','won','lost'));

comment on column public.leads.stage is
  'Etapa do CRM: new, qualified, quoting, quoted, won, lost. Muda pela aplicação, nunca por trigger.';
