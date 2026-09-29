-- 304 · Categorias de serviço: General Maintenance, Cleaning, Certificates
--
-- Até aqui a categoria de um serviço era adivinhada pelo nome em quatro
-- lugares (dois no OS, dois no portal). Agora ela é um dado: cada linha do
-- catálogo aponta para uma categoria, o dono cria novas pela tela e move
-- serviços entre elas. É o que liga job → serviço → categoria → parceiro →
-- disponibilidade → auto-assign (plano de 29/09/2026).
--
-- Backfill pelo nome, com a mesma regra do resolveCatalogServiceCategory:
-- limpeza pelo "clean"/"tenancy"; certificado pelas palavras de laudo;
-- o resto (ofícios) em General Maintenance.

create table if not exists public.service_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  sort       integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.service_categories (name, slug, sort) values
  ('General Maintenance', 'general-maintenance', 10),
  ('Cleaning', 'cleaning', 20),
  ('Certificates', 'certificates', 30)
on conflict (slug) do nothing;

alter table public.service_catalog
  add column if not exists category_id uuid references public.service_categories(id) on delete set null;

create index if not exists service_catalog_category_idx on public.service_catalog (category_id);

-- Limpeza
update public.service_catalog c
   set category_id = (select id from public.service_categories where slug = 'cleaning')
 where c.category_id is null
   and (c.name ~* 'clean' or c.name ~* 'tenancy');

-- Certificados e laudos
update public.service_catalog c
   set category_id = (select id from public.service_categories where slug = 'certificates')
 where c.category_id is null
   and c.name ~* '(certificate|report|assessment|survey|inspection|testing|gas safety|boiler service|fire extinguisher|epc|eicr|legionella|asbestos)';

-- O resto: ofícios
update public.service_catalog c
   set category_id = (select id from public.service_categories where slug = 'general-maintenance')
 where c.category_id is null;

alter table public.service_categories enable row level security;

drop policy if exists "service_categories_read" on public.service_categories;
create policy "service_categories_read" on public.service_categories
  for select to authenticated using (true);

drop policy if exists "service_categories_staff_write" on public.service_categories;
create policy "service_categories_staff_write" on public.service_categories
  for all to authenticated
  using (public.is_internal_staff())
  with check (public.is_internal_staff());

grant select on public.service_categories to authenticated;
grant insert, update, delete on public.service_categories to authenticated;

comment on table public.service_categories is
  'Categoria do serviço (General Maintenance, Cleaning, Certificates...). Agrupa o catálogo, os serviços do parceiro e a capacidade do dia.';
comment on column public.service_catalog.category_id is
  'Categoria do serviço. Fonte única: substitui a adivinhação pelo nome.';
