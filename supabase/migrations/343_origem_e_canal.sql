-- =============================================================================
-- Migration 343: origem da oportunidade e canal ativo · 22/10/2026
-- =============================================================================
--
-- Plano do dono (22/10/2026): origem (source) é de onde a oportunidade veio e
-- serve para atribuição e análise; não substitui a regra da conta. Canal ativo
-- é por onde o cliente está conversando agora (email ou whatsapp).
--
--   - lead_channels ganha as origens das plataformas e do anúncio;
--   - jobs.source e quotes.source: a origem DESTA oportunidade;
--   - clients.first_source: a origem da primeira vez (não muda);
--   - jobs/quotes.conversation_channel: o canal ativo.
--
-- jobs.external_source / external_ref continuam como estão (são o sistema de
-- origem, quase sempre zendesk, e a chave de idempotência do job).
--
-- Backfill só onde há prova (conta de plataforma, harvey_wa_leads, site_leads).
-- O resto fica nulo: melhor nulo que inventado.
-- Idempotente.

insert into public.lead_channels (key, label)
values ('checkatrade_express', 'Checkatrade Express'),
       ('housekeep', 'Housekeep'),
       ('fantastic', 'Fantastic Services'),
       ('meta_ad', 'Meta ad (WhatsApp)'),
       ('b2b_email', 'Business email')
on conflict (key) do nothing;

alter table public.jobs add column if not exists source text references public.lead_channels(key) on update cascade;
alter table public.quotes add column if not exists source text references public.lead_channels(key) on update cascade;
alter table public.clients add column if not exists first_source text references public.lead_channels(key) on update cascade;

alter table public.jobs add column if not exists conversation_channel text;
alter table public.quotes add column if not exists conversation_channel text;
alter table public.jobs drop constraint if exists jobs_conversation_channel_check;
alter table public.jobs add constraint jobs_conversation_channel_check check (conversation_channel in ('email', 'whatsapp'));
alter table public.quotes drop constraint if exists quotes_conversation_channel_check;
alter table public.quotes add constraint quotes_conversation_channel_check check (conversation_channel in ('email', 'whatsapp'));

-- Plataformas: a origem é a própria plataforma.
update public.jobs set source = 'checkatrade_express' where source is null and account_id = '38b48520-f116-4263-90e5-8cd5a7d39ecf';
update public.jobs set source = 'housekeep'           where source is null and account_id = '9659bbfb-eb56-4a31-9773-7f5e1335d0b4';
update public.jobs set source = 'fantastic'           where source is null and account_id = '3da39c93-4456-4ab1-9bcc-4e87d9564dbd';
update public.jobs set source = 'checkatrade'         where source is null and account_id = '8060fcf3-a538-4e5a-9318-1b49ee59f432';

-- Reserva do site: o canal do lead do site.
update public.jobs j set source = s.channel
  from public.site_leads s
 where s.job_id = j.id and j.source is null and s.channel is not null;

-- Primeiro contato pelo Harvey: lead do Checkatrade (origem lead) ou Express.
update public.jobs j set source = case when w.origem = 'express' then 'checkatrade_express' else 'checkatrade' end,
                         conversation_channel = coalesce(j.conversation_channel, 'whatsapp')
  from public.harvey_wa_leads w
 where w.job_id = j.id and j.source is null and w.origem in ('lead', 'express');

update public.clients c set first_source = 'housekeep'           where first_source is null and source_account_id = '9659bbfb-eb56-4a31-9773-7f5e1335d0b4';
update public.clients c set first_source = 'checkatrade_express' where first_source is null and source_account_id = '38b48520-f116-4263-90e5-8cd5a7d39ecf';
update public.clients c set first_source = 'fantastic'           where first_source is null and source_account_id = '3da39c93-4456-4ab1-9bcc-4e87d9564dbd';
update public.clients c set first_source = 'checkatrade'         where first_source is null and source_account_id = '8060fcf3-a538-4e5a-9318-1b49ee59f432';

comment on column public.jobs.source is 'Origem desta oportunidade (lead_channels.key). Atribuição e análise; a regra vem da conta. Migration 343.';
comment on column public.clients.first_source is 'Origem da primeira oportunidade desta pessoa. Não muda. Migration 343.';
comment on column public.jobs.conversation_channel is 'Canal ativo com o cliente: email ou whatsapp. Migration 343.';
