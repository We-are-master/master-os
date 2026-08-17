-- O PRICEBOOK: o preço exato da Fixfy por serviço — labour, nunca material.
--
-- A 254 (labour_prices) é a RÉGUA: o que o mercado do UK cobra. Esta tabela é
-- o PREÇO: um número exato por serviço, derivado da régua por uma fórmula
-- declarada linha a linha no `basis` — número de Londres quando a fonte deu,
-- senão o típico UK +20%, posicionado no TÍPICO do mercado (serviço
-- gerenciado não cobra o piso do freelancer), arredondado a preço limpo
-- (£5 até £100, £10 até £500, £25 acima; certificado termina em 9, convenção
-- da categoria). Nenhum serviço abaixo do call-out de £90.
--
-- Regras fixadas pelo dono (17/08/2026):
--   · handyman_time é a ÚNICA precificação por tempo do sistema, e é fixa;
--   · todo o resto é POR SERVIÇO, com unidade exata (m2 tem job mínimo,
--     TV tem polegada, cômodo tem tamanho) — sem unidade exata não há preço;
--   · material NUNCA entra no labour: cota-se à parte via supplier_prices
--     × 1.30, itemizado;
--   · elétrica só existe como certificado (certificates), nada de instalação.
--
-- Fluxo de aprovação: tudo nasce status='draft'. O dono revisa, ajusta
-- (override_gbp SEMPRE ganha de price_gbp) e aprova; só linha aprovada é
-- cotada por Mike, pelo agente do Zendesk e pelo /api/ai/price-check. Quando
-- o supplier-RPA renovar a régua, o pricebook NÃO muda sozinho: preço só
-- muda com reaprovação.
--
-- Fora deste rascunho, de propósito: CLEANING (EOT/Deep) — a varredura de
-- labour não cobriu limpeza; os preços vigentes do catálogo continuam valendo
-- até pesquisarmos referência própria.

create table if not exists service_pricebook (
  id            uuid primary key default gen_random_uuid(),
  trade         text not null,
  service       text not null,
  unit          text not null,
  -- O preço exato do rascunho (labour). Se override_gbp existir, ELE vale.
  price_gbp     numeric not null,
  -- Para unidades por m2/painel: o job mínimo que paga a visita.
  min_charge_gbp numeric,
  -- De onde o número saiu — a fórmula auditável, linha a linha.
  basis         text not null,
  status        text not null default 'draft' check (status in ('draft','approved','retired')),
  override_gbp  numeric,
  approved_by   text,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (trade, service)
);

create index if not exists service_pricebook_trade_idx on service_pricebook (trade);

insert into service_pricebook (trade, service, unit, price_gbp, min_charge_gbp, basis) values
  ('handyman_time', 'Call-out (first hour)', 'per_job', 90, null, 'ja validado: mercado Londres cobra £72 (Silver Saints 30min) a £119 (TaskRabbit fatura media) na primeira visita'),
  ('handyman_time', 'Additional hour', 'per_hour', 65, null, 'Londres media £38-£51/h; operador premium £80-£100/h; £65 = premium-medio'),
  ('handyman_time', 'Half day (up to 4h)', 'per_half_day', 280, null, 'premium Londres cobra £280-£380 a meia diaria; custo parceiro £100'),
  ('handyman_time', 'Full day (up to 8h)', 'per_day', 480, null, 'Londres tipico £225/dia, premium £500-£650; custo parceiro £200; £480 = premium-medio'),
  ('handyman', 'TV wall mounting up to 43"', 'per_job', 120, null, 'TaskRabbit 32-43" £80-£150 +Londres; hoje cotamos £90 no respond.io: REVISAR'),
  ('handyman', 'TV wall mounting 44-55"', 'per_job', 150, null, 'TaskRabbit 43-55" £100-£180, meio +Londres'),
  ('handyman', 'TV wall mounting 56-65"', 'per_job', 190, null, 'TaskRabbit 55-65" £130-£220'),
  ('handyman', 'TV wall mounting over 65"', 'per_job', 240, null, 'TaskRabbit 65"+ £180-£300'),
  ('handyman', 'Flat-pack assembly, single item (up to 1h)', 'per_item', 90, null, 'mercado £40-£80; piso = call-out £90'),
  ('handyman', 'Flat-pack wardrobe PAX/sliding doors', 'per_item', 160, null, 'mercado £70-£130 (2-4h) +Londres'),
  ('handyman', 'Hanging pictures/mirrors/shelves (up to 3 items)', 'per_job', 90, null, 'mercado £40-£70; piso = call-out'),
  ('handyman', 'Blind or curtain pole fitting (first window)', 'per_window', 95, null, 'mercado £50-£90 Londres'),
  ('handyman', 'Blind/pole additional window (same visit)', 'per_window', 45, null, 'metade: deslocamento ja pago'),
  ('handyman', 'Easing/adjusting a sticking door', 'per_job', 90, null, 'mercado £50-£90; piso = call-out'),
  ('handyman', 'Door handle or lock replacement (labour)', 'per_job', 95, null, 'mercado £50-£100; material via supplier_prices'),
  ('handyman', 'Euro cylinder/barrel change (labour)', 'per_job', 95, null, 'mercado £100 supply+fit tipico; cilindro a parte'),
  ('handyman', 'Bath/shower silicone reseal', 'per_job', 130, null, 'Silver Saints £132 fixo; mercado £80-£150'),
  ('handyman', 'Gutter clean - terraced', 'per_job', 120, null, 'UK £100 +20% Londres'),
  ('handyman', 'Gutter clean - semi-detached', 'per_job', 150, null, 'UK £125 +20%'),
  ('handyman', 'Gutter clean - detached', 'per_job', 180, null, 'UK £150 +20%'),
  ('handyman', 'Draught proofing external door', 'per_job', 100, null, 'mercado ~£100 c/ material basico'),
  ('handyman', 'Small plaster patch repair', 'per_job', 110, null, 'mercado £60-£120'),
  ('handyman', 'Radiator bleed / minor check visit', 'per_job', 90, null, 'mercado £60-£90; piso = call-out'),
  ('painter', 'Paint small bedroom (walls+ceiling, 2 coats)', 'per_room', 300, null, 'Checkatrade sala 8m2 £350 c/ material; labour Londres'),
  ('painter', 'Paint medium bedroom/living (walls+ceiling)', 'per_room', 400, null, 'Checkatrade £450 c/ material; MyBuilder £300-£500'),
  ('painter', 'Paint large room (walls+ceiling)', 'per_room', 600, null, 'Checkatrade sala 30m2 £1000 c/ material; labour'),
  ('painter', 'Paint ceiling only', 'per_m2', 18, 120, 'Checkatrade £10-£20/m2 +Londres; minimo cobre meia visita'),
  ('painter', 'Paint interior door (both sides)', 'per_door', 110, null, 'Checkatrade £80-£100 +Londres'),
  ('painter', 'Paint skirting, average room', 'per_room', 220, null, 'PriceYourJob £200-£300 (£150 labour + material)'),
  ('painter', 'Wallpaper hanging, average room (paper excl.)', 'per_room', 450, null, 'Checkatrade £350-£500 labour-only, £12-£16/m2'),
  ('painter', 'Mist coat on new plaster, per room', 'per_room', 140, null, 'MyBuilder £80-£150'),
  ('painter', 'Full repaint 1-bed flat', 'per_job', 1400, null, 'derivado do 2-bed £1.5k-£2.5k Checkatrade'),
  ('painter', 'Full repaint 2-bed flat', 'per_job', 1900, null, 'Checkatrade £1,500-£2,500 tipico £2,000'),
  ('painter', 'Hallway, stairs and landing', 'per_job', 1600, null, 'Checkatrade £1,450-£1,750'),
  ('painter', 'Paint front door (prep + gloss)', 'per_job', 350, null, 'hamuch job medio £351'),
  ('carpenter', 'Hang internal door (door excl.)', 'per_door', 140, null, 'Checkatrade £100-£140 labour +Londres; porta via supplier_prices'),
  ('carpenter', 'Fit fire door FD30 (compliance fit, door excl.)', 'per_door', 180, null, 'fonte fit-only £30-£50 e irreal p/ compliance: 2-3h de carpinteiro Londres'),
  ('carpenter', 'Install external/front door (labour)', 'per_door', 600, null, 'Checkatrade £500-£1,000 labour'),
  ('carpenter', 'Replace skirting, medium room (labour)', 'per_room', 280, null, 'PriceYourJob £300-£800 c/ material; labour Londres'),
  ('carpenter', 'Replace architrave, per door', 'per_door', 100, null, 'hamuch £100/porta c/ material'),
  ('carpenter', 'Alcove shelving/cupboard (bespoke, materials excl.)', 'per_job', 950, null, 'hamuch Londres £850-£1,540 quotes'),
  ('carpenter', 'Built-in fitted wardrobe', 'per_job', 1200, null, 'Checkatrade £800-£1,400'),
  ('carpenter', 'Boxing-in pipes', 'per_job', 400, null, 'hamuch Londres £303-£763, tipico £467'),
  ('carpenter', 'New loft hatch installation', 'per_job', 250, null, 'Checkatrade £150-£525 tipico £240'),
  ('flooring', 'Laminate fitting (labour)', 'per_m2', 15, 180, 'MyBuilder Londres £12-£18/m2; minimo paga a visita'),
  ('flooring', 'LVT fitting (labour)', 'per_m2', 18, 200, 'MyBuilder labour £10-£20/m2 topo Londres'),
  ('flooring', 'Engineered wood fitting (labour)', 'per_m2', 50, 300, 'Checkatrade £45-£55/m2'),
  ('flooring', 'Floor sanding + refinish', 'per_m2', 22, 280, 'PriceYourJob £16-£19/m2 +Londres'),
  ('flooring', 'Carpet fitting, standard room (labour)', 'per_room', 110, null, 'Checkatrade diaria £150-£250, cômodo = meia'),
  ('flooring', 'Trim door after new flooring', 'per_door', 25, null, 'Checkatrade £20-£30'),
  ('tiler', 'Wall tiling (labour)', 'per_m2', 50, 250, 'Checkatrade tipico £50/m2; Rated People £30-£60'),
  ('tiler', 'Floor tiling (labour)', 'per_m2', 55, 250, 'piso paga mais que parede; Rated People topo £60'),
  ('tiler', 'Full bathroom tiling, walls+floor (labour)', 'per_job', 1100, null, 'Checkatrade £800-£1,200 (3-4 dias)'),
  ('tiler', 'Kitchen splashback (labour)', 'per_job', 220, null, 'meia diaria de tiler Londres £180-£250'),
  ('tiler', 'Regrout full bathroom', 'per_job', 400, null, 'Checkatrade tipico £380'),
  ('tiler', 'Regrout shower enclosure', 'per_job', 180, null, 'Checkatrade £160; silicone +£50-£100'),
  ('tiler', 'Remove old tiles + adhesive', 'per_m2', 12, 150, 'Checkatrade cômodo £800-£900 => ~£12/m2'),
  ('plasterer', 'Skim single wall', 'per_job', 200, null, 'PriceYourJob £150-£200 topo Londres'),
  ('plasterer', 'Skim medium room (walls)', 'per_room', 520, null, 'Checkatrade £480 tipico +Londres'),
  ('plasterer', 'Skim ceiling, medium', 'per_job', 400, null, 'Checkatrade £360 tipico +Londres'),
  ('plasterer', 'Overboard + skim damaged ceiling', 'per_job', 850, null, 'Checkatrade £700-£1,000'),
  ('plasterer', 'Plaster patch repair (proper)', 'per_job', 130, null, 'PriceYourJob £70-£130'),
  ('plasterer', 'Cover artex (plaster over), per surface', 'per_job', 300, null, 'PriceYourJob £150-£250 plaster-over +Londres'),
  ('paving', 'Patio laying (labour)', 'per_m2', 70, 700, 'Checkatrade labour-only £35-£100/m2'),
  ('paving', 'Block paving driveway (labour)', 'per_m2', 45, 900, 'Checkatrade labour £30-£50/m2'),
  ('paving', 'Patio repointing', 'per_m2', 18, 200, 'Checkatrade £10-£20/m2'),
  ('paving', 'Pressure washing patio/driveway', 'per_m2', 5, 150, 'Checkatrade £3-£4.50/m2 +Londres'),
  ('fencing', 'Fence panel replacement (labour)', 'per_panel', 55, 220, 'MyBuilder £40-£60/painel; painel £108.99 via supplier_prices'),
  ('fencing', 'Fence post replacement (labour)', 'per_post', 110, null, 'Checkatrade £150 fitted c/ material; poste+postcrete a parte'),
  ('decking', 'Decking installation (labour)', 'per_m2', 40, 500, 'MyBuilder £20-£50/m2 (raised no topo)'),
  ('garden', 'Turf laying (labour)', 'per_m2', 22, 200, 'Checkatrade £10-£30/m2; grama do fornecedor a parte'),
  ('garden', 'Garden clearance', 'per_load', 250, null, 'Checkatrade tipico £210/load +Londres'),
  ('plumber', 'Replace kitchen/basin tap (fit only)', 'per_item', 140, null, 'Checkatrade tipico £140; torneira via supplier_prices'),
  ('plumber', 'Replace toilet (fit only)', 'per_item', 220, null, 'Checkatrade £150-£300'),
  ('plumber', 'Toilet fill/flush valve repair (labour)', 'per_item', 110, null, 'Checkatrade £60-£110 supply+fit; valvula £26.99 lista'),
  ('plumber', 'Replace radiator like-for-like (labour)', 'per_item', 220, null, 'Checkatrade/Rated People £150-£300'),
  ('plumber', 'Unblock sink or toilet', 'per_item', 140, null, 'Checkatrade £75-£150 +Londres'),
  ('plumber', 'Unblock external drain (rodding)', 'per_item', 160, null, 'Checkatrade rodding £85, jetting £185'),
  ('plumber', 'Install washing machine/dishwasher', 'per_item', 110, null, 'Checkatrade £40-£90; piso acima do call-out'),
  ('plumber', 'Replace bar mixer shower (labour)', 'per_item', 200, null, 'Checkatrade £200 labour'),
  ('plumber', 'Outside tap installation', 'per_item', 160, null, 'Checkatrade £120-£200'),
  ('certificates', 'EICR - studio', 'per_job', 129, null, 'mercado £125-£300, Londres +15-20%; parceiro £69'),
  ('certificates', 'EICR - 1-2 bed', 'per_job', 149, null, 'mercado UK medio £212; parceiro £79'),
  ('certificates', 'EICR - 3-4 bed', 'per_job', 189, null, 'mercado 3-bed £200-£250; parceiro £99'),
  ('certificates', 'EICR - 5+ bed', 'per_job', 229, null, 'mercado ate £300+; parceiro >=£99'),
  ('certificates', 'EPC', 'per_job', 95, null, 'parceiro £79; Checkatrade paga £56-£97'),
  ('certificates', 'Gas Safety CP12 (up to 2 appliances)', 'per_job', 95, null, 'parceiro £60'),
  ('certificates', 'Gas Safety CP12 (3+ appliances)', 'per_job', 110, null, 'parceiro £70'),
  ('certificates', 'PAT testing (up to 10 items)', 'per_job', 110, null, 'mercado PAT £60-£120 base'),
  ('certificates', 'Fire Risk Assessment (FRA)', 'per_job', 220, null, 'mercado FRA residencial £150-£300'),
  ('certificates', 'Fire Alarm Certificate (FAC)', 'per_job', 150, null, 'parceiro £59'),
  ('certificates', 'Emergency Lighting Certificate', 'per_job', 150, null, 'paridade FAC; mesmo esforco de visita')
on conflict (trade, service) do nothing;
