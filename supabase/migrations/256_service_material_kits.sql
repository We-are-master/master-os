-- O KIT de material de cada serviço: o que "trocar torneira" leva junto.
--
-- 256 de 17/08/2026. Liga o service_pricebook (labour) ao supplier_prices
-- (material) por NOME — trade+service de um lado, family+variant do outro —
-- porque nomes são a chave estável entre os seeds. O price-check soma:
-- labour aprovado + Σ(kit × qty × preço da view material_quotes).
--
-- `qty` é por UMA unidade do serviço: num serviço por m² (azulejo), o kit
-- também é por m² (0.25 saco de cola/m²); num por poste, é por poste.
-- `optional` marca o que depende do cliente ou do diagnóstico (a torneira
-- que ele pode já ter comprado, o suporte de TV, fill vs flush valve) — a
-- quote mostra como opção em vez de somar cegamente. Serviço sem kit aqui
-- continua cotável: sai só o labour, com o gap declarado.

create table if not exists service_material_kits (
  id        uuid primary key default gen_random_uuid(),
  trade     text not null,
  service   text not null,
  family    text not null,
  variant   text not null,
  qty       numeric not null default 1,
  optional  boolean not null default false,
  note      text,
  created_at timestamptz not null default now(),
  unique (trade, service, family, variant)
);

create index if not exists service_material_kits_service_idx on service_material_kits (trade, service);

insert into service_material_kits (trade, service, family, variant, qty, optional, note) values
  ('plumber', 'Replace kitchen/basin tap (fit only)', 'plumbing', 'Torneira misturadora cozinha', 1, true, 'cliente pode ja ter comprado a torneira'),
  ('plumber', 'Replace kitchen/basin tap (fit only)', 'plumbing', 'Flexíveis (par)', 1, false, null),
  ('plumber', 'Replace kitchen/basin tap (fit only)', 'plumbing', 'Válvula de isolamento 15mm', 2, false, null),
  ('plumber', 'Toilet fill/flush valve repair (labour)', 'plumbing', 'Válvula de enchimento (fill valve)', 1, true, 'uma das duas, conforme diagnostico'),
  ('plumber', 'Toilet fill/flush valve repair (labour)', 'plumbing', 'Válvula de descarga (flush valve)', 1, true, 'uma das duas, conforme diagnostico'),
  ('plumber', 'Replace toilet (fit only)', 'plumbing', 'Flexíveis (par)', 1, false, null),
  ('plumber', 'Replace toilet (fit only)', 'sealant', 'Silicone branco (standard)', 1, false, null),
  ('plumber', 'Replace bar mixer shower (labour)', 'plumbing', 'Ducha + mangueira', 1, true, 'se o cliente nao tiver o conjunto'),
  ('plumber', 'Replace bar mixer shower (labour)', 'sealant', 'Sanitário HA6 (banheiro)', 1, false, null),
  ('handyman', 'Bath/shower silicone reseal', 'sealant', 'Sanitário HA6 (banheiro)', 1, false, null),
  ('handyman', 'TV wall mounting up to 43"', 'tv_bracket', 'Tilt 32–55"', 1, true, 'se o cliente nao tiver suporte'),
  ('handyman', 'TV wall mounting up to 43"', 'fixings', 'Buchas heavy-duty p/ drywall', 1, true, 'parede de drywall'),
  ('handyman', 'TV wall mounting 44-55"', 'tv_bracket', 'Full-motion 32–55"', 1, true, 'se o cliente nao tiver suporte'),
  ('handyman', 'TV wall mounting 44-55"', 'fixings', 'Buchas heavy-duty p/ drywall', 1, true, 'parede de drywall'),
  ('handyman', 'TV wall mounting 56-65"', 'tv_bracket', 'Fixed/tilt 55–85"', 1, true, 'se o cliente nao tiver suporte'),
  ('handyman', 'TV wall mounting 56-65"', 'fixings', 'Buchas heavy-duty p/ drywall', 1, true, 'parede de drywall'),
  ('handyman', 'TV wall mounting over 65"', 'tv_bracket', 'Fixed/tilt 55–85"', 1, true, 'se o cliente nao tiver suporte'),
  ('handyman', 'TV wall mounting over 65"', 'fixings', 'Buchas heavy-duty p/ drywall', 1, true, 'parede de drywall'),
  ('handyman', 'Door handle or lock replacement (labour)', 'door_handle', 'Lever handle on rose satin (pair)', 1, true, 'se trocar a maçaneta'),
  ('handyman', 'Door handle or lock replacement (labour)', 'door_latch', 'Tubular mortice latch 64mm', 1, true, 'se trocar o trinco'),
  ('handyman', 'Hanging pictures/mirrors/shelves (up to 3 items)', 'fixings', 'Buchas sortidas parede', 1, false, null),
  ('handyman', 'Hanging pictures/mirrors/shelves (up to 3 items)', 'shelf_bracket', '150mm (par)', 1, true, 'quando ha prateleira'),
  ('handyman', 'Blind or curtain pole fitting (first window)', 'blind', 'Veneziana 90cm', 1, true, 'se o cliente nao tiver a persiana'),
  ('handyman', 'Blind or curtain pole fitting (first window)', 'curtain_pole', 'Extensível 120–210cm', 1, true, 'se for varão'),
  ('handyman', 'Blind or curtain pole fitting (first window)', 'fixings', 'Buchas sortidas parede', 1, false, null),
  ('handyman', 'Small plaster patch repair', 'filler', 'Filler pronto (interior)', 1, false, null),
  ('handyman', 'Small plaster patch repair', 'paint_sundries', 'Lixa sortida (pack 10)', 1, false, null),
  ('carpenter', 'Hang internal door (door excl.)', 'internal_door', 'White primed 762mm (30") — padrão', 1, true, 'porta por estilo/medida do cliente'),
  ('carpenter', 'Hang internal door (door excl.)', 'door_hinge', 'Butt hinge 75mm satin (pair)', 1.5, false, '3 dobradiças = 1,5 par'),
  ('carpenter', 'Hang internal door (door excl.)', 'door_latch', 'Tubular mortice latch 64mm', 1, false, null),
  ('carpenter', 'Hang internal door (door excl.)', 'door_handle', 'Lever handle on rose satin (pair)', 1, true, 'se trocar a maçaneta'),
  ('carpenter', 'Fit fire door FD30 (compliance fit, door excl.)', 'internal_door', 'Fire door FD30 762mm', 1, true, 'porta por medida; FD30 obrigatoria'),
  ('carpenter', 'Fit fire door FD30 (compliance fit, door excl.)', 'door_hinge', 'Fire door hinge grade 13 CE 100mm (pack of 3)', 1, false, null),
  ('carpenter', 'Fit fire door FD30 (compliance fit, door excl.)', 'door_latch', 'Fire-rated tubular latch 76mm (FD30/60)', 1, false, null),
  ('carpenter', 'Fit fire door FD30 (compliance fit, door excl.)', 'door_handle', 'Fire-rated lever handle (pair)', 1, false, null),
  ('painter', 'Paint small bedroom (walls+ceiling, 2 coats)', 'paint', 'Emulsão branca matt 5L (trade)', 1, false, null),
  ('painter', 'Paint small bedroom (walls+ceiling, 2 coats)', 'paint_sundries', 'Fita de pintor 48mm', 1, false, null),
  ('painter', 'Paint small bedroom (walls+ceiling, 2 coats)', 'paint_sundries', 'Lona/dust sheet', 1, false, null),
  ('painter', 'Paint small bedroom (walls+ceiling, 2 coats)', 'paint_sundries', 'Kit rolo + bandeja', 1, false, null),
  ('painter', 'Paint medium bedroom/living (walls+ceiling)', 'paint', 'Emulsão branca matt 5L (trade)', 1, false, null),
  ('painter', 'Paint medium bedroom/living (walls+ceiling)', 'paint', 'Emulsão de teto 5L', 1, true, 'se o teto pedir tinta propria'),
  ('painter', 'Paint medium bedroom/living (walls+ceiling)', 'paint_sundries', 'Fita de pintor 48mm', 1, false, null),
  ('painter', 'Paint medium bedroom/living (walls+ceiling)', 'paint_sundries', 'Lona/dust sheet', 1, false, null),
  ('painter', 'Paint medium bedroom/living (walls+ceiling)', 'paint_sundries', 'Kit rolo + bandeja', 1, false, null),
  ('painter', 'Paint medium bedroom/living (walls+ceiling)', 'filler', 'Filler pronto (interior)', 1, true, 'paredes com furos'),
  ('painter', 'Paint large room (walls+ceiling)', 'paint', 'Emulsão branca matt 5L (trade)', 2, false, null),
  ('painter', 'Paint large room (walls+ceiling)', 'paint_sundries', 'Fita de pintor 48mm', 1, false, null),
  ('painter', 'Paint large room (walls+ceiling)', 'paint_sundries', 'Lona/dust sheet', 1, false, null),
  ('painter', 'Paint large room (walls+ceiling)', 'paint_sundries', 'Kit rolo + bandeja', 1, false, null),
  ('painter', 'Paint interior door (both sides)', 'paint', 'Gloss branco 2.5L (madeira)', 0.5, false, 'meio pote por porta'),
  ('painter', 'Paint interior door (both sides)', 'paint_sundries', 'Lixa sortida (pack 10)', 0.5, false, null),
  ('painter', 'Paint front door (prep + gloss)', 'paint', 'Gloss branco 2.5L (madeira)', 1, false, null),
  ('painter', 'Paint front door (prep + gloss)', 'paint_sundries', 'Lixa sortida (pack 10)', 1, false, null),
  ('painter', 'Paint front door (prep + gloss)', 'paint_sundries', 'Fita de pintor 48mm', 1, false, null),
  ('painter', 'Mist coat on new plaster, per room', 'paint', 'Emulsão branca matt 5L (trade)', 1, false, null),
  ('tiler', 'Regrout full bathroom', 'tiling', 'Rejunte impermeável 1.5kg', 2, false, null),
  ('tiler', 'Regrout full bathroom', 'sealant', 'Sanitário HA6 (banheiro)', 1, false, null),
  ('tiler', 'Regrout shower enclosure', 'tiling', 'Rejunte impermeável 1.5kg', 1, false, null),
  ('tiler', 'Regrout shower enclosure', 'sealant', 'Sanitário HA6 (banheiro)', 1, false, null),
  ('tiler', 'Wall tiling (labour)', 'tiling', 'Cola de azulejo rapid-set 20kg', 0.25, false, '1 saco cobre ~4m2; qty por m2'),
  ('tiler', 'Wall tiling (labour)', 'tiling', 'Rejunte impermeável 1.5kg', 0.15, false, 'qty por m2'),
  ('tiler', 'Floor tiling (labour)', 'tiling', 'Cola de azulejo rapid-set 20kg', 0.3, false, 'piso consome mais; qty por m2'),
  ('tiler', 'Floor tiling (labour)', 'tiling', 'Rejunte impermeável 1.5kg', 0.15, false, 'qty por m2'),
  ('plasterer', 'Plaster patch repair (proper)', 'filler', 'Filler pronto (interior)', 1, false, null),
  ('fencing', 'Fence panel replacement (labour)', 'garden', 'Painel de cerca closeboard 6×6 (unidade)', 1, false, 'qty por painel'),
  ('fencing', 'Fence post replacement (labour)', 'garden', 'Poste de cerca 75mm 2.4m (unidade)', 1, false, 'qty por poste'),
  ('fencing', 'Fence post replacement (labour)', 'garden', 'Postcrete/PostFix 20kg', 2, false, '2 sacos por poste')
on conflict (trade, service, family, variant) do nothing;

-- 18/08: kit da linha de caulking nascida do #48833.
insert into service_material_kits (trade, service, family, variant, qty, optional, note) values
  ('handyman', 'Crack filling & caulking (interior, up to ~2m)', 'sealant', 'Silicone branco (standard)', 1, false, 'caulk/decorators sealant')
on conflict (trade, service, family, variant) do nothing;
