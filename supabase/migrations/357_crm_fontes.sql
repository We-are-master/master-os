-- 357 · CRM de Leads e Quotes, fase 5 (fontes do funil)
--
-- A reserva abandonada do site (site_leads) e o primeiro contato do Harvey
-- (harvey_wa_leads) passam a alimentar um lead do CRM (public.leads, mig 356).
-- A aplicação cria ou acha o lead e grava o vínculo aqui:
--
--   site_leads.lead_id       o lead do CRM que nasceu quando o cliente
--                            respondeu (antes da resposta, nada: decisão do dono)
--   harvey_wa_leads.lead_id  o lead do primeiro contato do Harvey, para achar o
--                            lead da conversa do WhatsApp mesmo depois que o
--                            ticket do lead é juntado no da conversa
--
-- Só acrescenta. Nenhum trigger: quem liga é a aplicação
-- (src/lib/crm/fontes-servidor.ts). Pode rodar mais de uma vez.

alter table public.site_leads
  add column if not exists lead_id uuid;

do $$ begin
  alter table public.site_leads add constraint site_leads_lead_id_fkey
    foreign key (lead_id) references public.leads(id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists site_leads_lead_idx on public.site_leads (lead_id) where lead_id is not null;

comment on column public.site_leads.lead_id is
  'Lead do CRM (public.leads) criado quando o cliente respondeu. Ligado pela aplicação, nunca por trigger.';

alter table public.harvey_wa_leads
  add column if not exists lead_id uuid;

do $$ begin
  alter table public.harvey_wa_leads add constraint harvey_wa_leads_lead_id_fkey
    foreign key (lead_id) references public.leads(id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists harvey_wa_leads_lead_idx on public.harvey_wa_leads (lead_id) where lead_id is not null;

comment on column public.harvey_wa_leads.lead_id is
  'Lead do CRM (public.leads) do primeiro contato. Ligado pela aplicação quando o ticket do lead nasce.';

-- O espelho de leads (scripts/espelho-leads.mts) lê os leads vivos com ticket.
create index if not exists leads_ticket_vivo_idx on public.leads (stage)
  where deleted_at is null and external_source = 'zendesk' and external_ref is not null;
