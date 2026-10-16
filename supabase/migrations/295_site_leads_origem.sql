-- 295 · Leads: origem, lead lançado à mão e importação por CSV
--
-- A aba Leads deixa de ser só "reserva abandonada do site": o time também
-- lança lead que chegou por WhatsApp, telefone, indicação, formulário da Meta
-- etc., um a um ou em massa por CSV. Cada origem vai ganhar o seu fluxo; por
-- enquanto só o do site (os três e-mails de retomada) existe, então lead de
-- outra origem nasce com sequence_state = 'none'.
--
-- Roda DEPOIS da 294.

alter table public.site_leads add column if not exists channel text not null default 'website';
alter table public.site_leads add column if not exists notes text;
alter table public.site_leads add column if not exists tags text[] not null default '{}';
alter table public.site_leads add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- Lead de WhatsApp às vezes só tem telefone: basta e-mail OU telefone.
alter table public.site_leads alter column email drop not null;
alter table public.site_leads drop constraint if exists site_leads_contato_chk;
alter table public.site_leads add constraint site_leads_contato_chk
  check (coalesce(nullif(trim(email), ''), nullif(trim(phone), '')) is not null);

alter table public.site_leads drop constraint if exists site_leads_channel_chk;
alter table public.site_leads add constraint site_leads_channel_chk
  check (channel in ('website', 'whatsapp', 'phone', 'email', 'meta_form', 'referral', 'checkatrade', 'walk_in', 'other'));

-- 'none': lead sem sequência automática (ainda não existe fluxo para a origem dele).
alter table public.site_leads drop constraint if exists site_leads_sequence_state_check;
alter table public.site_leads add constraint site_leads_sequence_state_check
  check (sequence_state in ('scheduled', 'paused', 'stopped', 'done', 'none'));

-- Um lead aberto por telefone também (quem só tem WhatsApp).
create unique index if not exists site_leads_open_phone_uidx
  on public.site_leads (regexp_replace(phone, '\D', '', 'g'))
  where status in ('new', 'hot', 'contacted') and email is null and phone is not null;

create index if not exists site_leads_channel_idx on public.site_leads (channel, last_activity_at desc);

comment on column public.site_leads.channel is
  'Origem: website (reserva no site) · whatsapp · phone · email · meta_form · referral · checkatrade · walk_in · other.';
