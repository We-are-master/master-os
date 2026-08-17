-- O cache de preço de material do orçamentista.
--
-- Nasceu da varredura de demanda de 17/08/2026 (905 enquiries do respond.io +
-- 433 jobs do OS + 3.442 tickets do Zendesk, classificados por tarefa): porta
-- interna, flat-pack, TV, EOT e jardim dominam, e os materiais recorrentes
-- desses jobs são os 14 semeados abaixo — preço REAL da Screwfix, mediana de
-- 5 produtos, colhido ao vivo na data da migração.
--
-- Desenho: `unit_cost` é FATO (o que o fornecedor cobra); `list_price` é
-- POLÍTICA (custo × margem, hoje 1.4, arredondado pra cima no .99). O
-- orçamentista lê daqui; o supplier-RPA renova `unit_cost` quando `fetched_at`
-- envelhece (TTL sugerido: 30 dias) e recalcula `list_price` com a margem
-- vigente. A margem de 1.4 é rascunho do dia 1 — mudar a política é UPDATE
-- numa coluna, não caça a preços espalhados.

create table if not exists supplier_prices (
  id           uuid primary key default gen_random_uuid(),
  -- A chave de busca canônica ("door hinges 100mm") — é por ela que o
  -- orçamentista pergunta e o supplier-RPA renova.
  query        text not null unique,
  label        text not null,
  supplier     text not null default 'screwfix',
  unit_cost    numeric(10,2) not null,
  -- custo × margem, recalculado a cada renovação. Nunca editar na mão:
  -- margem mora na política, não na linha.
  markup       numeric(4,2) not null default 1.40,
  list_price   numeric(10,2) not null,
  sample_product text,
  source_url   text,
  fetched_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table supplier_prices is
  'Cache de preço de material (orçamentista). unit_cost = fato do fornecedor; list_price = unit_cost × markup (política). Renovado pelo supplier-RPA por TTL.';

insert into supplier_prices (query, label, unit_cost, markup, list_price, sample_product) values
  ('door hinges 100mm',       'Door hinges (pair, 100mm)',        3.99, 1.40,   5.59, 'Screwfix mediana de 5 produtos, 17/08/2026'),
  ('tubular mortice latch',   'Tubular mortice latch',            2.97, 1.40,   4.19, 'Screwfix mediana de 5 produtos, 17/08/2026'),
  ('internal door handle',    'Internal door handle (set)',      22.49, 1.40,  31.49, 'Screwfix mediana de 5 produtos, 17/08/2026'),
  ('silicone sealant white',  'Silicone sealant (white)',         5.89, 1.40,   8.29, 'Screwfix mediana de 5 produtos, 17/08/2026'),
  ('decorators filler',       'Decorators filler',                5.49, 1.40,   7.69, 'Screwfix mediana de 5 produtos, 17/08/2026'),
  ('wood filler',             'Wood filler',                     14.99, 1.40,  20.99, 'Screwfix mediana de 5 produtos, 17/08/2026'),
  ('tv wall bracket',         'TV wall bracket',                 25.99, 1.40,  36.39, 'Screwfix mediana de 5 produtos, 17/08/2026'),
  ('curtain pole',            'Curtain pole',                    17.99, 1.40,  25.19, 'Screwfix mediana de 5 produtos, 17/08/2026'),
  ('white emulsion paint 5l', 'White emulsion paint (5L)',       38.99, 1.40,  54.59, 'Screwfix mediana de 5 produtos, 17/08/2026'),
  ('wood screws assorted',    'Wood screws (assorted pack)',     22.99, 1.40,  32.19, 'Screwfix mediana de 5 produtos, 17/08/2026'),
  ('shelf brackets',          'Shelf brackets (pair)',           13.99, 1.40,  19.59, 'Screwfix mediana de 5 produtos, 17/08/2026'),
  ('mdf board 12mm',          'MDF board (12mm sheet)',          54.99, 1.40,  76.99, 'Screwfix mediana de 5 produtos, 17/08/2026'),
  ('venetian blind',          'Venetian blind (standard)',       16.99, 1.40,  23.79, 'Screwfix mediana de 5 produtos, 17/08/2026'),
  ('internal door 762mm',     'Internal door (762mm standard)', 139.99, 1.40, 195.99, 'Screwfix mediana de 5 produtos, 17/08/2026')
on conflict (query) do nothing;
