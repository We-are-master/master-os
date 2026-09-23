-- Limpeza: as faixas de 4 e 5+ quartos com 1 banheiro (dono, 23/09/2026).
--
-- O site vende qualquer tamanho com 1 banheiro, e o banheiro extra entra pela
-- escada de add-ons (£42, £52, £66). O catálogo tinha 4 quartos só com 2
-- banheiros e 5 quartos só com 3: uma reserva de 4 quartos e 1 banheiro
-- (£384 no end of tenancy) não tinha faixa igual no OS. Com estas seis, todo
-- tamanho do site tem a faixa de 1 banheiro, e o resto se monta com os
-- add-ons de banheiro que já existem.
--
-- Valores tirados do próprio código do site (pricing.js e
-- server/b2c/partner-pay.js), não digitados à mão:
--   end of tenancy  4 bed £384 / £237   5 bed £451 / £277
--   deep clean      4 bed £356 / £227   5 bed £422 / £267
--   after builders  4 bed £388 / £237   5 bed £455 / £277
-- Parceiro: base do tipo (£140, £130, £140) mais a escada por quarto extra
-- (£26, £31, £40, £40).
--
-- Aplicado direto no banco de produção em 23/09/2026. Rodar de novo deixa o
-- mesmo estado: as seis faixas têm id fixo e são trocadas, não duplicadas, e
-- a lista volta ordenada por sort_order (65 entre 3·2 e 4·2, 75 entre 4·2 e
-- 5·3). Nenhuma faixa existente muda de id, porque o job guarda
-- `catalog_pricing_preset_id`.

update service_catalog s
set pricing_presets = (
  select jsonb_agg(e order by (e->>'sort_order')::numeric)
  from (
    select e from jsonb_array_elements(s.pricing_presets) e
    where e->>'id' not in ('c0275424-72cb-4942-9c5c-459482c37cc5', 'e74b1ef8-8977-47b4-a47a-e8c56a8b36f9')
    union all
    select e from jsonb_array_elements($json$[
      {"id":"c0275424-72cb-4942-9c5c-459482c37cc5","label":"4 bed · 1 bath","sort_order":65,"fixed_price":384,"partner_cost":237,"pricing_mode":"fixed"},
      {"id":"e74b1ef8-8977-47b4-a47a-e8c56a8b36f9","label":"5 bed · 1 bath","sort_order":75,"fixed_price":451,"partner_cost":277,"pricing_mode":"fixed"}
    ]$json$::jsonb) e
  ) t(e)
), updated_at = now()
where s.name = 'End of Tenancy Clean' and s.is_active;

update service_catalog s
set pricing_presets = (
  select jsonb_agg(e order by (e->>'sort_order')::numeric)
  from (
    select e from jsonb_array_elements(s.pricing_presets) e
    where e->>'id' not in ('40f8925e-914b-423d-96e0-d069fec4f986', 'adc627eb-9b36-46f9-82ed-bc84abaa5019')
    union all
    select e from jsonb_array_elements($json$[
      {"id":"40f8925e-914b-423d-96e0-d069fec4f986","label":"4 bed · 1 bath","sort_order":65,"fixed_price":356,"partner_cost":227,"pricing_mode":"fixed"},
      {"id":"adc627eb-9b36-46f9-82ed-bc84abaa5019","label":"5 bed · 1 bath","sort_order":75,"fixed_price":422,"partner_cost":267,"pricing_mode":"fixed"}
    ]$json$::jsonb) e
  ) t(e)
), updated_at = now()
where s.name = 'Deep Clean' and s.is_active;

update service_catalog s
set pricing_presets = (
  select jsonb_agg(e order by (e->>'sort_order')::numeric)
  from (
    select e from jsonb_array_elements(s.pricing_presets) e
    where e->>'id' not in ('1b7a2d21-948e-49c0-9e22-71a63fe97308', '0263c9e3-9f34-4e87-8f48-995ab533fa3d')
    union all
    select e from jsonb_array_elements($json$[
      {"id":"1b7a2d21-948e-49c0-9e22-71a63fe97308","label":"4 bed · 1 bath","sort_order":65,"fixed_price":388,"partner_cost":237,"pricing_mode":"fixed"},
      {"id":"0263c9e3-9f34-4e87-8f48-995ab533fa3d","label":"5 bed · 1 bath","sort_order":75,"fixed_price":455,"partner_cost":277,"pricing_mode":"fixed"}
    ]$json$::jsonb) e
  ) t(e)
), updated_at = now()
where s.name = 'After Builders Clean' and s.is_active;
