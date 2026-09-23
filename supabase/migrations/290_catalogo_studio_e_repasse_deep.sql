-- Limpeza: studio 10% abaixo do 1 quarto e o repasse novo do deep clean
-- (dono, 23/09/2026).
--
-- Preço do studio, igual ao site (pricing.js): end of tenancy £200, deep
-- clean £174, after builders £204. O dono mudou na tela do OS às 19h UTC;
-- esta migration só registra.
--
-- Repasse do deep clean: £110 no studio, £120 no 1 quarto e £20 por quarto a
-- mais (2 bed £140, 3 bed £160, 4 bed £180, 5 bed £200). A faixa com mais
-- banheiros soma a escada do add-on de banheiro, que não mudou (£26 o
-- segundo, £31 o terceiro): 2 bed · 2 bath £166, 3 bed · 2 bath £186,
-- 4 bed · 2 bath £206, 5 bed · 3 bath £257. O preço ao cliente do deep não
-- muda fora do studio. End of tenancy e after builders mantêm o repasse.
--
-- Aplicada direto no banco de produção em 23/09/2026. Rodar de novo deixa o
-- mesmo estado: troca só os campos listados, pelo id da faixa, sem mudar id
-- nem ordem (o job guarda `catalog_pricing_preset_id`).

update service_catalog s
set pricing_presets = (
  select jsonb_agg(case when v.patch is null then t.e else t.e || v.patch::jsonb end order by t.i)
  from jsonb_array_elements(s.pricing_presets) with ordinality t(e, i)
  left join (values
    -- studio dos três tipos
    ('5a52ce98-1a79-4b89-a632-b1683ee487b8', '{"fixed_price":200,"partner_cost":140}'),
    ('866b6b01-272d-4d22-bc45-c78117dae32f', '{"fixed_price":204,"partner_cost":140}'),
    ('4f57e359-079e-48d4-8b8b-73b6f2eb4dcc', '{"fixed_price":174,"partner_cost":110}'),
    -- deep clean: £120 no 1 quarto e £20 por quarto a mais
    ('24128e9a-a7eb-427e-b917-bd7183eabf87', '{"partner_cost":120}'),
    ('db2e9b02-7f4b-4ee4-847c-7ff4a66feb47', '{"partner_cost":140}'),
    ('03026a9e-74b4-49c7-8e11-53eace35b667', '{"partner_cost":160}'),
    ('40f8925e-914b-423d-96e0-d069fec4f986', '{"partner_cost":180}'),
    ('adc627eb-9b36-46f9-82ed-bc84abaa5019', '{"partner_cost":200}'),
    -- deep clean com mais banheiros: a faixa de 1 banheiro mais a escada
    ('3f3c9324-d750-4b63-ba9e-bc611e8c296d', '{"partner_cost":166}'),
    ('f97363f5-001d-491d-ba8e-7eaeca0b7d96', '{"partner_cost":186}'),
    ('5cd67932-b753-4d93-90df-f9d3eb252885', '{"partner_cost":206}'),
    ('ced932e6-eef7-4620-8743-80fa10178b61', '{"partner_cost":257}')
  ) v(id, patch) on v.id = t.e->>'id'
), updated_at = now()
where s.is_active
  and s.name in ('End of Tenancy Clean', 'Deep Clean', 'After Builders Clean');
