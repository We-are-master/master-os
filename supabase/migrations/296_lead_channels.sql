-- 296 · Origens de lead editáveis (Settings → Lead origins)
--
-- A lista fixa da 295 (check em site_leads.channel) vira tabela: o time cria,
-- renomeia, desativa e reordena origens sem mexer em código. A CHAVE nunca
-- muda depois de criada (é o que fica gravado em cada lead); o NOME é livre.
-- Desativar só tira a origem dos formulários e do CSV: lead antigo continua.
--
-- Roda DEPOIS da 295.

create table if not exists public.lead_channels (
  key        text primary key check (key ~ '^[a-z0-9_]{2,30}$'),
  label      text not null,
  active     boolean not null default true,
  sort       integer not null default 100,
  -- Como o time escreve essa origem numa planilha (minúsculas): "wa", "zap"...
  aliases    text[] not null default '{}',
  created_at timestamptz not null default now()
);

insert into public.lead_channels (key, label, sort, aliases) values
  ('website',     'Website',     10, '{site,web,getfixfy}'),
  ('whatsapp',    'WhatsApp',    20, '{wa,zap,whats}'),
  ('phone',       'Phone',       30, '{call,telefone,ligacao,tel}'),
  ('email',       'Email',       40, '{e-mail,mail}'),
  ('meta_form',   'Meta form',   50, '{meta,facebook,instagram,lead_form}'),
  ('referral',    'Referral',    60, '{indicacao,indicação}'),
  ('checkatrade', 'Checkatrade', 70, '{}'),
  ('walk_in',     'Walk-in',     80, '{walkin,presencial}'),
  ('other',       'Other',       90, '{outro,outros}')
on conflict (key) do nothing;

-- A trava passa a ser a tabela: origem que não existe nela não entra.
alter table public.site_leads drop constraint if exists site_leads_channel_chk;
alter table public.site_leads drop constraint if exists site_leads_channel_fkey;
alter table public.site_leads add constraint site_leads_channel_fkey
  foreign key (channel) references public.lead_channels(key) on update cascade;

alter table public.lead_channels enable row level security;

drop policy if exists "lead_channels_staff_all" on public.lead_channels;
create policy "lead_channels_staff_all"
  on public.lead_channels for all to authenticated
  using (public.is_internal_staff())
  with check (public.is_internal_staff());

grant select, insert, update on public.lead_channels to authenticated;

comment on table public.lead_channels is
  'Origens de lead (Settings → Lead origins). key fixa, label livre, active tira dos formulários, aliases valem no CSV.';
