-- O PRICEBOOK: o preço exato da Fixfy por serviço — labour, nunca material.
--
-- A 254 (labour_prices) é a RÉGUA: o que o mercado do UK cobra. Esta tabela é
-- o PREÇO: um número exato por serviço, derivado da régua por uma fórmula
-- declarada linha a linha no `basis` — número de Londres quando a fonte deu,
-- senão o típico UK +20%, posicionado no TÍPICO do mercado (serviço
-- gerenciado não cobra o piso do freelancer), arredondado a preço limpo
-- (£5 até £100, £10 até £500, £25 acima; certificado termina em 9, convenção
-- da categoria). Nenhum serviço abaixo de uma visita mínima (~£90).
--
-- Regras fixadas pelo dono (17/08/2026):
--   · handyman_time é a ÚNICA precificação por tempo do sistema, e é fixa;
--   · todo o resto é POR SERVIÇO, com unidade exata (m2 tem job mínimo,
--     TV tem polegada, cômodo tem tamanho) — sem unidade exata não há preço;
--   · material NUNCA entra no labour: cota-se à parte via supplier_prices
--     × 1.30, itemizado;
--   · elétrica só existe como certificado (certificates), nada de instalação.
--
-- REVISADO E APROVADO pelo dono em 17/08/2026 (chat), com dois ajustes:
--   handyman fica na régua que o OS JÁ TEM (£72/h, mínimo 1h — sem lógica
--   nova de preço), com meia diária £190 e diária £290 substituindo os
--   presets inativos de £149/£220; certificados espelham o CATÁLOGO do OS
--   faixa a faixa (preços já validados com margem sobre o parceiro) — o
--   catálogo segue sendo a fonte da verdade deles, o espelho é conveniência
--   do orçamentista. Só o Emergency Lighting continua draft: fixed=0 no
--   catálogo, não há preço validado para manter.
--
-- Fluxo de aprovação: linha nova nasce status='draft'. O dono revisa, ajusta
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
  price_gbp     numeric not null,
  min_charge_gbp numeric,
  basis         text not null,
  status        text not null default 'draft' check (status in ('draft','approved','retired')),
  override_gbp  numeric,
  approved_by   text,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (trade, service)
);

create index if not exists service_pricebook_trade_idx on service_pricebook (trade);

insert into service_pricebook (trade, service, unit, price_gbp, min_charge_gbp, basis, status, approved_by, approved_at) values
  ('handyman_time', 'Hourly rate (min 1 hour)', 'per_hour', 72, null, 'como ja esta no OS (General Maintenance £72/h, parceiro £40/h); decisao do dono 17/08: nada de logica nova de preco no OS', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman_time', 'Half day (up to 4h)', 'per_half_day', 190, null, 'preco fixado pelo dono (17/08): £190; substitui o preset inativo de £149; custo parceiro £100', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman_time', 'Full day (up to 8h)', 'per_day', 290, null, 'preco fixado pelo dono (17/08): £290; substitui o preset inativo de £220; custo parceiro £200', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'TV wall mounting up to 43"', 'per_job', 120, null, 'TaskRabbit 32-43" £80-£150 +Londres; hoje cotamos £90 no respond.io: REVISAR', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'TV wall mounting 44-55"', 'per_job', 150, null, 'TaskRabbit 43-55" £100-£180, meio +Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'TV wall mounting 56-65"', 'per_job', 190, null, 'TaskRabbit 55-65" £130-£220', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'TV wall mounting over 65"', 'per_job', 240, null, 'TaskRabbit 65"+ £180-£300', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Flat-pack assembly, single item (up to 1h)', 'per_item', 90, null, 'mercado £40-£80; piso de visita minima', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Flat-pack wardrobe PAX/sliding doors', 'per_item', 160, null, 'mercado £70-£130 (2-4h) +Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Hanging pictures/mirrors/shelves (up to 3 items)', 'per_job', 90, null, 'mercado £40-£70; piso de visita minima', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Blind or curtain pole fitting (first window)', 'per_window', 95, null, 'mercado £50-£90 Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Blind/pole additional window (same visit)', 'per_window', 45, null, 'metade: deslocamento ja pago', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Easing/adjusting a sticking door', 'per_job', 90, null, 'mercado £50-£90; piso de visita minima', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Door handle or lock replacement (labour)', 'per_job', 95, null, 'mercado £50-£100; material via supplier_prices', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Euro cylinder/barrel change (labour)', 'per_job', 95, null, 'mercado £100 supply+fit tipico; cilindro a parte', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Bath/shower silicone reseal', 'per_job', 130, null, 'Silver Saints £132 fixo; mercado £80-£150', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Gutter clean - terraced', 'per_job', 120, null, 'UK £100 +20% Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Gutter clean - semi-detached', 'per_job', 150, null, 'UK £125 +20%', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Gutter clean - detached', 'per_job', 180, null, 'UK £150 +20%', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Draught proofing external door', 'per_job', 100, null, 'mercado ~£100 c/ material basico', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Small plaster patch repair', 'per_job', 110, null, 'mercado £60-£120', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('handyman', 'Radiator bleed / minor check visit', 'per_job', 90, null, 'mercado £60-£90; piso de visita minima', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('painter', 'Paint small bedroom (walls+ceiling, 2 coats)', 'per_room', 300, null, 'Checkatrade sala 8m2 £350 c/ material; labour Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('painter', 'Paint medium bedroom/living (walls+ceiling)', 'per_room', 400, null, 'Checkatrade £450 c/ material; MyBuilder £300-£500', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('painter', 'Paint large room (walls+ceiling)', 'per_room', 600, null, 'Checkatrade sala 30m2 £1000 c/ material; labour', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('painter', 'Paint ceiling only', 'per_m2', 18, 120, 'Checkatrade £10-£20/m2 +Londres; minimo cobre meia visita', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('painter', 'Paint interior door (both sides)', 'per_door', 110, null, 'Checkatrade £80-£100 +Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('painter', 'Paint skirting, average room', 'per_room', 220, null, 'PriceYourJob £200-£300 (£150 labour + material)', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('painter', 'Wallpaper hanging, average room (paper excl.)', 'per_room', 450, null, 'Checkatrade £350-£500 labour-only, £12-£16/m2', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('painter', 'Mist coat on new plaster, per room', 'per_room', 140, null, 'MyBuilder £80-£150', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('painter', 'Full repaint 1-bed flat', 'per_job', 1400, null, 'derivado do 2-bed £1.5k-£2.5k Checkatrade', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('painter', 'Full repaint 2-bed flat', 'per_job', 1900, null, 'Checkatrade £1,500-£2,500 tipico £2,000', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('painter', 'Hallway, stairs and landing', 'per_job', 1600, null, 'Checkatrade £1,450-£1,750', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('painter', 'Paint front door (prep + gloss)', 'per_job', 350, null, 'hamuch job medio £351', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('carpenter', 'Hang internal door (door excl.)', 'per_door', 140, null, 'Checkatrade £100-£140 labour +Londres; porta via supplier_prices', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('carpenter', 'Fit fire door FD30 (compliance fit, door excl.)', 'per_door', 180, null, 'fonte fit-only £30-£50 e irreal p/ compliance: 2-3h de carpinteiro Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('carpenter', 'Install external/front door (labour)', 'per_door', 600, null, 'Checkatrade £500-£1,000 labour', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('carpenter', 'Replace skirting, medium room (labour)', 'per_room', 280, null, 'PriceYourJob £300-£800 c/ material; labour Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('carpenter', 'Replace architrave, per door', 'per_door', 100, null, 'hamuch £100/porta c/ material', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('carpenter', 'Alcove shelving/cupboard (bespoke, materials excl.)', 'per_job', 950, null, 'hamuch Londres £850-£1,540 quotes', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('carpenter', 'Built-in fitted wardrobe', 'per_job', 1200, null, 'Checkatrade £800-£1,400', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('carpenter', 'Boxing-in pipes', 'per_job', 400, null, 'hamuch Londres £303-£763, tipico £467', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('carpenter', 'New loft hatch installation', 'per_job', 250, null, 'Checkatrade £150-£525 tipico £240', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('flooring', 'Laminate fitting (labour)', 'per_m2', 15, 180, 'MyBuilder Londres £12-£18/m2; minimo paga a visita', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('flooring', 'LVT fitting (labour)', 'per_m2', 18, 200, 'MyBuilder labour £10-£20/m2 topo Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('flooring', 'Engineered wood fitting (labour)', 'per_m2', 50, 300, 'Checkatrade £45-£55/m2', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('flooring', 'Floor sanding + refinish', 'per_m2', 22, 280, 'PriceYourJob £16-£19/m2 +Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('flooring', 'Carpet fitting, standard room (labour)', 'per_room', 110, null, 'Checkatrade diaria £150-£250, cômodo = meia', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('flooring', 'Trim door after new flooring', 'per_door', 25, null, 'Checkatrade £20-£30', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('tiler', 'Wall tiling (labour)', 'per_m2', 50, 250, 'Checkatrade tipico £50/m2; Rated People £30-£60', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('tiler', 'Floor tiling (labour)', 'per_m2', 55, 250, 'piso paga mais que parede; Rated People topo £60', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('tiler', 'Full bathroom tiling, walls+floor (labour)', 'per_job', 1100, null, 'Checkatrade £800-£1,200 (3-4 dias)', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('tiler', 'Kitchen splashback (labour)', 'per_job', 220, null, 'meia diaria de tiler Londres £180-£250', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('tiler', 'Regrout full bathroom', 'per_job', 400, null, 'Checkatrade tipico £380', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('tiler', 'Regrout shower enclosure', 'per_job', 180, null, 'Checkatrade £160; silicone +£50-£100', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('tiler', 'Remove old tiles + adhesive', 'per_m2', 12, 150, 'Checkatrade cômodo £800-£900 => ~£12/m2', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plasterer', 'Skim single wall', 'per_job', 200, null, 'PriceYourJob £150-£200 topo Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plasterer', 'Skim medium room (walls)', 'per_room', 520, null, 'Checkatrade £480 tipico +Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plasterer', 'Skim ceiling, medium', 'per_job', 400, null, 'Checkatrade £360 tipico +Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plasterer', 'Overboard + skim damaged ceiling', 'per_job', 850, null, 'Checkatrade £700-£1,000', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plasterer', 'Plaster patch repair (proper)', 'per_job', 130, null, 'PriceYourJob £70-£130', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plasterer', 'Cover artex (plaster over), per surface', 'per_job', 300, null, 'PriceYourJob £150-£250 plaster-over +Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('paving', 'Patio laying (labour)', 'per_m2', 70, 700, 'Checkatrade labour-only £35-£100/m2', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('paving', 'Block paving driveway (labour)', 'per_m2', 45, 900, 'Checkatrade labour £30-£50/m2', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('paving', 'Patio repointing', 'per_m2', 18, 200, 'Checkatrade £10-£20/m2', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('paving', 'Pressure washing patio/driveway', 'per_m2', 5, 150, 'Checkatrade £3-£4.50/m2 +Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('fencing', 'Fence panel replacement (labour)', 'per_panel', 55, 220, 'MyBuilder £40-£60/painel; painel £108.99 via supplier_prices', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('fencing', 'Fence post replacement (labour)', 'per_post', 110, null, 'Checkatrade £150 fitted c/ material; poste+postcrete a parte', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('decking', 'Decking installation (labour)', 'per_m2', 40, 500, 'MyBuilder £20-£50/m2 (raised no topo)', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('garden', 'Turf laying (labour)', 'per_m2', 22, 200, 'Checkatrade £10-£30/m2; grama do fornecedor a parte', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('garden', 'Garden clearance', 'per_load', 250, null, 'Checkatrade tipico £210/load +Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plumber', 'Replace kitchen/basin tap (fit only)', 'per_item', 140, null, 'Checkatrade tipico £140; torneira via supplier_prices', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plumber', 'Replace toilet (fit only)', 'per_item', 220, null, 'Checkatrade £150-£300', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plumber', 'Toilet fill/flush valve repair (labour)', 'per_item', 110, null, 'Checkatrade £60-£110 supply+fit; valvula £26.99 lista', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plumber', 'Replace radiator like-for-like (labour)', 'per_item', 220, null, 'Checkatrade/Rated People £150-£300', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plumber', 'Unblock sink or toilet', 'per_item', 140, null, 'Checkatrade £75-£150 +Londres', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plumber', 'Unblock external drain (rodding)', 'per_item', 160, null, 'Checkatrade rodding £85, jetting £185', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plumber', 'Install washing machine/dishwasher', 'per_item', 110, null, 'Checkatrade £40-£90; piso acima do call-out', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plumber', 'Replace bar mixer shower (labour)', 'per_item', 200, null, 'Checkatrade £200 labour', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('plumber', 'Outside tap installation', 'per_item', 160, null, 'Checkatrade £120-£200', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EICR - Studio (up to 8 circuits)', 'per_job', 100, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £69', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EICR - 1-bed Flat (up to 8 circuits)', 'per_job', 100, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £78.29', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EICR - 2 Bed Property (up to 8 circuits)', 'per_job', 127, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £79', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EICR - 3 Bed Property (up to 10 circuits)', 'per_job', 149.5, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £99', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EICR - 4 Bed Property (up to 12 circuits)', 'per_job', 172, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £109', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EICR - Up to 6 Bed Property (up to 14 circuits)', 'per_job', 203.5, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £139', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EPC - 1 Bed Flat', 'per_job', 56.35, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £46', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EPC - 1 Bed House', 'per_job', 59, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £46', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EPC - 2 Bed Flat', 'per_job', 63.55, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £55', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EPC - 2 Bed House', 'per_job', 66.7, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £55', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EPC - 3 Bed Flat', 'per_job', 71.2, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £65', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EPC - 3 Bed House', 'per_job', 74.35, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £65', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EPC - 4 Bed Flat', 'per_job', 78.85, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £65', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EPC - 4 Bed House', 'per_job', 81.55, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £65', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EPC - 5 Bed Flat', 'per_job', 86.05, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £80', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'EPC - 5 Bed House', 'per_job', 97.3, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £80', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'Gas Safety CP12 - 1 appliance', 'per_job', 70, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £60', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'Gas Safety CP12 - 2 appliances', 'per_job', 73, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £60', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'Gas Safety CP12 - 3 appliances', 'per_job', 82, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £60', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'Gas Safety CP12 - 4 appliances', 'per_job', 91, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £79.98', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'PAT - 1-10 items', 'per_job', 69, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £50', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'PAT - 11-20 items', 'per_job', 95, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £70', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'PAT - 21-30 items', 'per_job', 109, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £85', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'PAT - 31-40 items', 'per_job', 139, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £109', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'Fire Alarm Certificate - domestic (up to 10 devices)', 'per_job', 68.5, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £59', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'Fire Alarm Certificate - commercial simple (up to 15 devices)', 'per_job', 91, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £79', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - Studio Flat', 'per_job', 99, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £70', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - 1-2 Bed House', 'per_job', 109, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £n/d', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - 3 Bed House', 'per_job', 122.5, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £n/d', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - 4 Bed House', 'per_job', 135.95, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £n/d', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - 5 Bed House', 'per_job', 149.5, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £n/d', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - Single Storey Communal', 'per_job', 129, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £109', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - Two Storey Communal', 'per_job', 149, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £120', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - Three Storey Communal', 'per_job', 189, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £149', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - Four Storey Communal', 'per_job', 219, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £190', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - HMO & Rental 1-2 Beds', 'per_job', 189, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £140', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - HMO & Rental 3-4 Beds', 'per_job', 209, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £155', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - HMO & Rental 5-6 Beds', 'per_job', 219, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £175', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - Business up to 100 sq ft', 'per_job', 199, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £125', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - Business up to 50 sq m', 'per_job', 219, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £175', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - Business 1 storey up to 100 sq m', 'per_job', 229, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £199', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - Business 2-3 storey up to 100 sq m', 'per_job', 289, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £225', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - Business 1 storey up to 200 sq m', 'per_job', 299, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £249', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'FRA - Business 2-3 storey up to 200 sq m', 'per_job', 449, null, 'espelho do catalogo do OS (validado, decisao do dono 17/08); parceiro £349', 'approved', 'Victor (revisao completa em chat, 17/08/2026)', now()),
  ('certificates', 'Emergency Lighting Certificate', 'per_job', 150, null, 'SEM preco no catalogo (fixed=0): rascunho novo p/ validar; paridade FAC comercial', 'draft', null, null)
on conflict (trade, service) do nothing;
