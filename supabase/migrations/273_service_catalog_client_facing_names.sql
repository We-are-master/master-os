-- 273_service_catalog_client_facing_names.sql
--
-- O type of work passou a sair pro cliente (quote, email, WhatsApp, relatório),
-- e os nomes do catálogo carregavam a sigla interna no meio do nome:
-- "(EOT) End of Tenancy", "(DC) Deep Cleaning", "Gas Safety Certificate (GSC)".
-- Este rename tira a sigla e encurta o nome. O código continua entendendo os
-- nomes antigos (TYPE_OF_WORK_ALIASES em src/lib/type-of-work.ts), porque
-- ticket do Zendesk e email da Housekeep seguem escrevendo o nome velho.
--
-- O sync do Zendesk é OS -> Zendesk e casa a opção pelo UUID do serviço, então
-- a próxima edição de catálogo leva o nome novo pro tagger sem duplicar opção.
--
-- DRY RUN — o que muda no catálogo:
--   select id, name from public.service_catalog
--   where name in (
--     '(EOT) End of Tenancy','(AB) After Builders Cleaning','(DC) Deep Cleaning',
--     '(EICR) Electrical Installation Condition Report','Electrical Installation Condition Report (EICR)',
--     '(PAT) Portable Appliance Testing','Portable Appliance Testing (PAT)',
--     '(GSC) Gas Safety Certificate','Gas Safety Certificate (GSC)',
--     '(CP12)Gas Safety Check','(CP12) Gas Safety Check',
--     '(FRA) Fire Risk Assessment','Fire Risk Assessment (FRA)',
--     '(AMS) Asbestos Management Survey','(LRA) Legionella Risk Assessment',
--     '(FDI) Fire Door Inspection','(EPC-C) Commercial Energy Performance Certificate',
--     'Gas Safety Check (CP12)',
--     '(FES) Fire Extinguisher Service','Fire Extinguisher Service (FES)',
--     '(FAC) Fire Alarm Certificate','(EPC) Energy Performance Certificate'
--   );

begin;

create temp table _tow_rename (old_name text primary key, new_name text not null) on commit drop;

insert into _tow_rename (old_name, new_name) values
  ('(EOT) End of Tenancy',                             'End of Tenancy Clean'),
  ('(EOT) End of Tenancy Cleaning',                    'End of Tenancy Clean'),
  ('(AB) After Builders Cleaning',                     'After Builders Clean'),
  ('(DC) Deep Cleaning',                               'Deep Clean'),
  ('(EICR) Electrical Installation Condition Report',  'Electrical Safety Report'),
  ('Electrical Installation Condition Report (EICR)',  'Electrical Safety Report'),
  ('(PAT) Portable Appliance Testing',                 'Appliance Testing'),
  ('Portable Appliance Testing (PAT)',                 'Appliance Testing'),
  ('(GSC) Gas Safety Certificate',                     'Gas Safety Certificate'),
  ('Gas Safety Certificate (GSC)',                     'Gas Safety Certificate'),
  ('(CP12)Gas Safety Check',                           'Gas Safety Check'),
  ('(CP12) Gas Safety Check',                          'Gas Safety Check'),
  ('(FRA) Fire Risk Assessment',                       'Fire Risk Assessment'),
  ('Fire Risk Assessment (FRA)',                       'Fire Risk Assessment'),
  ('(FES) Fire Extinguisher Service',                  'Fire Extinguisher Service'),
  ('Fire Extinguisher Service (FES)',                  'Fire Extinguisher Service'),
  ('(FAC) Fire Alarm Certificate',                     'Fire Alarm Certificate'),
  ('(EPC) Energy Performance Certificate',             'Energy Performance Certificate'),
  ('Gas Safety Check (CP12)',                          'Gas Safety Check'),
  ('(AMS) Asbestos Management Survey',                 'Asbestos Management Survey'),
  ('(LRA) Legionella Risk Assessment',                 'Legionella Risk Assessment'),
  ('(FDI) Fire Door Inspection',                       'Fire Door Inspection'),
  ('(EPC-C) Commercial Energy Performance Certificate','Commercial Energy Performance Certificate');

-- 1) Catálogo: a fonte da verdade.
-- Duas guardas, porque `uq_service_catalog_name_active` é sobre
-- lower(trim(name)) e não perdoa:
--   a) duas linhas velhas que caem no MESMO nome novo (o catálogo tem
--      "(CP12)Gas Safety Check" e "Gas Safety Check (CP12)") — só a primeira
--      é renomeada, escolhida por ativa > mais antiga;
--   b) o nome novo já ocupado por outra linha viva.
-- O que sobrar aparece no notice do final e se resolve à mão, com merge de preço.
with candidate as (
  select
    sc.id,
    r.new_name,
    row_number() over (
      partition by lower(trim(r.new_name))
      order by sc.is_active desc, sc.created_at, sc.id
    ) as rn
  from public.service_catalog sc
  join _tow_rename r on lower(trim(sc.name)) = lower(trim(r.old_name))
  where sc.deleted_at is null
),
eligible as (
  select c.id, c.new_name
  from candidate c
  where c.rn = 1
    and not exists (
      select 1
      from public.service_catalog dup
      where dup.id <> c.id
        and dup.deleted_at is null
        and lower(trim(dup.name)) = lower(trim(c.new_name))
    )
)
update public.service_catalog sc
set name = e.new_name
from eligible e
where sc.id = e.id;

-- 2) Cópias desnormalizadas do nome. Todas por igualdade exata: título escrito
-- à mão ("EOT clean flat 3") não é tocado.
update public.jobs j
set title = r.new_name
from _tow_rename r
where j.title = r.old_name;

update public.quotes q
set title = r.new_name
from _tow_rename r
where q.title = r.old_name;

update public.quotes q
set service_type = r.new_name
from _tow_rename r
where q.service_type = r.old_name;

-- 3) Trades do parceiro: `trade` é texto, `trades` é array de rótulos.
update public.partners p
set trade = r.new_name
from _tow_rename r
where p.trade = r.old_name;

update public.partners p
set trades = (
  select array_agg(coalesce(r.new_name, t) order by ord)
  from unnest(p.trades) with ordinality as u(t, ord)
  left join _tow_rename r on r.old_name = u.t
)
where p.trades is not null
  and exists (
    select 1 from unnest(p.trades) as u(t)
    join _tow_rename r on r.old_name = u.t
  );

-- 4) O que ficou pra trás (nome novo já ocupado por outra linha do catálogo).
do $$
declare
  leftover text;
begin
  select string_agg(sc.name, ', ' order by sc.name) into leftover
  from public.service_catalog sc
  join _tow_rename r on lower(trim(r.old_name)) = lower(trim(sc.name))
  where sc.deleted_at is null;

  if leftover is not null then
    raise notice 'service_catalog: nomes nao renomeados por colisao: %', leftover;
  end if;
end $$;

commit;
