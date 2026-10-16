-- 311 · CRM B2B: funil de contas com etapas que o escritório edita
--
-- O dono quer ver todas as contas B2B e os leads de empresa num quadro e numa
-- lista, e mexer nas etapas sem pedir código: renomear, criar, apagar e mudar a
-- ordem. Por isso as etapas são linhas (`crm_stages`) e não um enum, e cada
-- card (`crm_deals`) aponta para uma etapa.
--
-- `kind` diz o que a etapa significa para os números: 'open' (ainda no funil),
-- 'won' (virou conta) e 'lost' (perdido). O nome é livre.
--
-- Um card pode apontar para uma conta já existente (`account_id`); no máximo um
-- card vivo por conta, para a importação das contas não duplicar.
--
-- O pipeline_deals da página /pipelines/corporate fica como está: etapas fixas,
-- vazio e escondido do menu.

create table if not exists public.crm_stages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  position    integer not null default 0,
  color       text not null default 'slate',
  kind        text not null default 'open' check (kind in ('open', 'won', 'lost')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.crm_deals (
  id              uuid primary key default gen_random_uuid(),
  company_name    text not null check (length(btrim(company_name)) > 0),
  stage_id        uuid not null references public.crm_stages(id) on delete restrict,
  account_id      uuid references public.accounts(id) on delete set null,
  segment         text,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  website         text,
  monthly_value   numeric,
  next_step       text,
  next_step_date  date,
  notes           text,
  source          text,
  position        double precision not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  deleted_at      timestamptz
);

create index if not exists crm_deals_stage_idx
  on public.crm_deals (stage_id, position)
  where deleted_at is null;

create unique index if not exists crm_deals_account_live_uq
  on public.crm_deals (account_id)
  where deleted_at is null and account_id is not null;

create or replace function public.touch_crm_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_crm_stages on public.crm_stages;
create trigger trg_touch_crm_stages before update on public.crm_stages
  for each row execute function public.touch_crm_updated_at();

drop trigger if exists trg_touch_crm_deals on public.crm_deals;
create trigger trg_touch_crm_deals before update on public.crm_deals
  for each row execute function public.touch_crm_updated_at();

alter table public.crm_stages enable row level security;
alter table public.crm_deals enable row level security;

drop policy if exists "crm_stages_staff" on public.crm_stages;
create policy "crm_stages_staff" on public.crm_stages
  for all to authenticated
  using (public.is_internal_staff())
  with check (public.is_internal_staff());

drop policy if exists "crm_deals_staff" on public.crm_deals;
create policy "crm_deals_staff" on public.crm_deals
  for all to authenticated
  using (public.is_internal_staff())
  with check (public.is_internal_staff());

-- As etapas que o dono pediu em 05/10/2026. Só entram se a tabela estiver vazia,
-- então rodar a migration de novo não duplica nem desfaz o que foi editado.
insert into public.crm_stages (name, position, color, kind)
select v.name, v.position, v.color, v.kind
from (values
  ('Business Lead', 0, 'slate', 'open'),
  ('Scheduled',     1, 'blue',  'open'),
  ('Onboarding',    2, 'amber', 'open'),
  ('Won',           3, 'green', 'won'),
  ('Lost',          4, 'red',   'lost')
) as v(name, position, color, kind)
where not exists (select 1 from public.crm_stages);

comment on table public.crm_stages is
  'Etapas do CRM B2B, editáveis pelo escritório (nome, cor, ordem). kind: open, won ou lost.';
comment on table public.crm_deals is
  'Cards do CRM B2B: uma empresa no funil, opcionalmente ligada a uma conta (accounts).';
