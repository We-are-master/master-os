-- End of tenancy: studio a £199, igual ao site (pricing.js), para o "from"
-- do site ficar abaixo de £200 (dono, 23/09/2026). O repasse não muda (£140).
--
-- Rodar de novo deixa o mesmo estado: troca só o preço, pelo id da faixa,
-- sem mudar id nem ordem (o job guarda `catalog_pricing_preset_id`).

update service_catalog s
set pricing_presets = (
  select jsonb_agg(case when t.e->>'id' = '5a52ce98-1a79-4b89-a632-b1683ee487b8'
                        then t.e || '{"fixed_price":199}'::jsonb else t.e end order by t.i)
  from jsonb_array_elements(s.pricing_presets) with ordinality t(e, i)
), updated_at = now()
where s.is_active
  and s.name = 'End of Tenancy Clean';
