-- Recrutamento de parceiros (dono, 24/09/2026): o funil /get-started do portal
-- passa a oferecer Carpenter, Plumber e Regular Cleaning, e o passo de rates
-- mostra o que pagamos em cada faixa. O picker lista o que está ativo aqui.
--
--  - Carpenter e Plumber saem do standby da 288 na régua do Handyman
--    (General Maintenance): cliente £72/h, £180 meia diária, £329 diária;
--    parceiro £40/h, £117, £214. Carpenter mantém os ids de faixa (jobs antigos
--    apontam para eles); Plumber não tinha faixas.
--  - Regular Cleaning é novo: limpeza recorrente de casa ocupada, por hora com
--    mínimo de 2 h, cliente £24/h e parceiro £16/h (Housekeep cobra £23 avulso
--    e £20,50 recorrente, sem produtos). Produtos e equipamento inclusos.
--
-- O site B2C não lê o catálogo (tem o pricing.js dele), então nada muda lá.

update service_catalog set
  is_active = true,
  sort_order = 52,
  pricing_mode = 'hourly',
  fixed_price = 0,
  hourly_rate = 72,
  default_hours = 1,
  partner_cost = 40,
  pricing_presets = $json$[{"id":"1ddf90c5-88b9-489a-a18e-66c6e3c93ce1","label":"Hourly (min 1 hour)","sort_order":10,"hourly_rate":72,"partner_cost":40,"pricing_mode":"hourly","default_hours":1},{"id":"fc15b9a9-6cc2-460f-b751-a978c2e945fd","label":"Half day (up to 3.5 hours)","sort_order":20,"fixed_price":180,"partner_cost":117,"pricing_mode":"fixed","default_hours":3.5},{"id":"6ac80960-78dc-42c3-8faa-9e9ee6f29765","label":"Full day (up to 7 hours)","sort_order":30,"fixed_price":329,"partner_cost":214,"pricing_mode":"fixed","default_hours":7}]$json$::jsonb,
  updated_at = now()
where id = '70c96d0e-da0f-495a-8d6d-c2a885dd6010';

update service_catalog set
  is_active = true,
  sort_order = 54,
  pricing_mode = 'hourly',
  fixed_price = 0,
  hourly_rate = 72,
  default_hours = 1,
  partner_cost = 40,
  pricing_presets = $json$[{"id":"b3f1c7a2-5d4e-4a8b-9c61-2f7e8d9a0b11","label":"Hourly (min 1 hour)","sort_order":10,"hourly_rate":72,"partner_cost":40,"pricing_mode":"hourly","default_hours":1},{"id":"c4a2d8b3-6e5f-4b9c-8d72-3a8f9eab1c22","label":"Half day (up to 3.5 hours)","sort_order":20,"fixed_price":180,"partner_cost":117,"pricing_mode":"fixed","default_hours":3.5},{"id":"d5b3e9c4-7f60-4cad-9e83-4b9a0fbc2d33","label":"Full day (up to 7 hours)","sort_order":30,"fixed_price":329,"partner_cost":214,"pricing_mode":"fixed","default_hours":7}]$json$::jsonb,
  updated_at = now()
where id = '2cf5b2a1-8c82-47aa-8305-c34697633924';

insert into service_catalog (
  name, pricing_mode, fixed_price, hourly_rate, default_hours, partner_cost,
  default_description, sort_order, is_active, display_icon_key,
  pricing_presets, pricing_addons, accepts_smart_price
)
select
  'Regular Cleaning', 'hourly', 0, 24, 2, 16,
  'Recurring clean of an occupied home, charged by the hour with a 2 hour minimum. Kitchen and bathrooms wiped and sanitised, dusting, hoovering and mopping throughout. All cleaning products and equipment (hoover, mop, cloths) are brought by the cleaner and included in the price.',
  35, true, (select display_icon_key from service_catalog where name = 'Deep Clean' and deleted_at is null limit 1),
  $json$[{"id":"e6c4fad5-8071-4dbe-8f94-5cab1acd3e44","label":"Hourly (min 2 hours)","sort_order":10,"hourly_rate":24,"partner_cost":16,"pricing_mode":"hourly","default_hours":2}]$json$::jsonb,
  '[]'::jsonb, true
where not exists (select 1 from service_catalog where name = 'Regular Cleaning' and deleted_at is null);
