-- O catálogo fecha nos seis serviços que o site vende (dono, 22 e 23/09/2026).
--
-- Estas mudanças foram aplicadas direto no banco de produção durante a
-- sessão, pela API, e este arquivo é o registro delas: rodar de novo deixa o
-- catálogo no mesmo estado, com os MESMOS ids de faixa e de add-on, porque
-- os jobs guardam `catalog_pricing_preset_id` e um id novo órfão o job.
--
-- A régua de preço, que é a mesma do site (master-website, pricing.js e
-- server/b2c/partner-pay.js):
--  - Limpeza: preço da Housekeep menos 5%, medido no quote deles em 22/09
--    para um postcode de Londres. Oito faixas por tipo, de studio a cinco
--    quartos com três banheiros. Parceiro recebe £140 no end of tenancy e no
--    after builders e £130 no deep, mais £26, £31, £40, £40 e £48 por quarto
--    e por banheiro extra. Banheiro extra ao cliente em escada: £42, £52, £66.
--  - General Maintenance: hora £72, meia diária £180 (3,5h), diária £329 (7h),
--    abaixo do Checkatrade Express (£190 e £350). É por aqui que entra o
--    "Repairs" do site; as linhas Handyman | Half Day e | Day Rate saem
--    porque repetiam o mesmo preço em outro lugar.
--  - Painter: touch-up £215, cômodo £450, diária £465, pacote de material £130.
--  - EICR no preço do Express: £129, £129, £165, £195, £225, £265.
--  - CP12 £79 a £109 por aparelho.
--  - EPC: o assessor cobra £60 cravado, então os pequenos têm piso de £95 (a
--    £75 do Express sobrava £1 depois do VAT); do três quartos para cima vale
--    o Express: £99, £109, £130.
--
-- A conferência site × OS (scripts/catalogo/conferir-site-os.mjs) fechou
-- 55 de 55 casos em 23/09/2026 (faixas, add-ons, escada do banheiro e os
-- títulos que o site manda como service_type).

-- End of Tenancy Clean: 8 faixas, 23 add-ons
update service_catalog set
  is_active = true,
  sort_order = 10,
  pricing_mode = 'fixed',
  fixed_price = 223,
  hourly_rate = 0,
  default_hours = 1,
  partner_cost = 140,
  default_description = 'Empty property, cleaned to the check-out checklist. Includes inside the oven and extractor, fridge and freezer, inside cupboards and appliances, descaling, grout, inside windows, hoovering and mopping. One cleaner up to 1 bedroom, two cleaners from 2 bedrooms. All cleaning products and equipment (hoover, mop, cloths) are brought by the team and are included in the price.',
  pricing_presets = $json$[{"id":"5a52ce98-1a79-4b89-a632-b1683ee487b8","label":"Studio · 1 bath","sort_order":10,"fixed_price":223,"partner_cost":140,"pricing_mode":"fixed"},{"id":"a806ebbf-ee4a-446a-a42f-455b175d46a8","label":"1 bed · 1 bath","sort_order":20,"fixed_price":223,"partner_cost":140,"pricing_mode":"fixed"},{"id":"ec70c018-8d8d-4df5-b609-c567e772fe39","label":"2 bed · 1 bath","sort_order":30,"fixed_price":266,"partner_cost":166,"pricing_mode":"fixed"},{"id":"8fd4947c-d7cf-4e58-9432-40b9c6088a25","label":"2 bed · 2 bath","sort_order":40,"fixed_price":308,"partner_cost":192,"pricing_mode":"fixed"},{"id":"f645949d-599c-4612-9a30-ed05f5a809ed","label":"3 bed · 1 bath","sort_order":50,"fixed_price":318,"partner_cost":197,"pricing_mode":"fixed"},{"id":"a9641297-1d3e-4f1d-bd15-2d593a8dc948","label":"3 bed · 2 bath","sort_order":60,"fixed_price":360,"partner_cost":223,"pricing_mode":"fixed"},{"id":"bb8454f5-c3a9-41fd-b375-42d57b7c65c7","label":"4 bed · 2 bath","sort_order":70,"fixed_price":426,"partner_cost":263,"pricing_mode":"fixed"},{"id":"65e244b8-4c50-4dca-9284-ff24ec3fb19f","label":"5 bed · 3 bath","sort_order":80,"fixed_price":545,"partner_cost":334,"pricing_mode":"fixed"}]$json$::jsonb,
  pricing_addons = $json$[{"id":"2cb850bc-4629-43c3-a207-6db6f33f47c8","label":"Extra bathroom, 2nd","sort_order":0,"fixed_price":42,"partner_cost":26},{"id":"49df408a-ceb3-4d8b-8f4d-99be53890f66","label":"Extra bathroom, 3rd","sort_order":10,"fixed_price":52,"partner_cost":31},{"id":"48d41afe-0c21-4372-a4c7-adb9fad313d9","label":"Extra bathroom, 4th","sort_order":20,"fixed_price":66,"partner_cost":40},{"id":"7af810fa-9552-4f7b-b17c-8550e6dc834b","label":"Extra room (office, dining, utility)","sort_order":30,"fixed_price":42,"partner_cost":26},{"id":"413dfb6c-7215-4349-8449-758898d92299","label":"Carpet steam clean (per room)","sort_order":40,"fixed_price":38,"partner_cost":23},{"id":"b5da987a-5f2f-4205-b26d-e8f02d7894fe","label":"Fridge freezer","sort_order":50,"fixed_price":43,"partner_cost":26},{"id":"1e3470ad-33b8-4b06-a398-e882cd8e5a2b","label":"Windows outside","sort_order":60,"fixed_price":35,"partner_cost":21},{"id":"79225e07-e556-4794-bd56-9f1257f9abb1","label":"Balcony, terrace or patio","sort_order":70,"fixed_price":57,"partner_cost":34},{"id":"111d4bde-e7e2-458b-a48a-bbe02bbfe627","label":"No free parking","sort_order":80,"fixed_price":14,"partner_cost":14},{"id":"2ce17ec0-a108-49b9-ae66-8842acedaf85","label":"Congestion charge","sort_order":90,"fixed_price":18,"partner_cost":18},{"id":"861ac00e-4c80-4d08-b2be-6de824d6ae39","label":"Rug","sort_order":100,"fixed_price":28,"partner_cost":17},{"id":"5f7101a2-461c-4046-8cac-f92a793366a5","label":"Curtains","sort_order":110,"fixed_price":43,"partner_cost":26},{"id":"a123a617-99f9-46a0-a4c3-5d48ed09c52a","label":"2 seater sofa","sort_order":120,"fixed_price":38,"partner_cost":23},{"id":"84f1ce0a-bb72-4bd2-902e-34a2ace29fce","label":"3 seater sofa","sort_order":130,"fixed_price":42,"partner_cost":25},{"id":"82ddcbcc-3a4b-42c3-a1a8-2f9362bd4ebf","label":"4 seater sofa","sort_order":140,"fixed_price":47,"partner_cost":28},{"id":"16e2d04d-3ecb-46da-931a-1a06306d7623","label":"L-shaped sofa 3 seats","sort_order":150,"fixed_price":52,"partner_cost":31},{"id":"6d8ef4a8-02ca-4cb9-9e4e-9e33dcf0438e","label":"L-shaped sofa 4 seats","sort_order":160,"fixed_price":71,"partner_cost":43},{"id":"8b9c9901-2742-47a5-944f-0baa61f61372","label":"L-shaped sofa 5 seats","sort_order":170,"fixed_price":85,"partner_cost":51},{"id":"a5b304bc-181a-4330-9422-16edc873a554","label":"Mattress single","sort_order":180,"fixed_price":23,"partner_cost":14},{"id":"e2ae4c71-1675-4ba5-bfd5-1cf01a4813ff","label":"Mattress double","sort_order":190,"fixed_price":33,"partner_cost":20},{"id":"4961def2-f7e7-49c8-be36-80478791fba6","label":"Mattress king","sort_order":200,"fixed_price":43,"partner_cost":26},{"id":"26448e35-54d7-4cf0-ac3c-88c6d4f7f802","label":"Blinds roman","sort_order":210,"fixed_price":38,"partner_cost":23},{"id":"37ea04ab-31a0-4ba3-9bb6-d69a790a15eb","label":"Blinds venetian","sort_order":220,"fixed_price":12,"partner_cost":7}]$json$::jsonb,
  updated_at = now()
where name = 'End of Tenancy Clean';

-- Deep Clean: 8 faixas, 23 add-ons
update service_catalog set
  is_active = true,
  sort_order = 20,
  pricing_mode = 'fixed',
  fixed_price = 194,
  hourly_rate = 0,
  default_hours = 1,
  partner_cost = 130,
  default_description = 'Occupied home, cleaned top to bottom around the furniture. Includes inside the oven, descaling of kitchen and bathrooms, hard to reach areas, inside windows, hoovering and mopping. Inside cupboards and appliances are not included. One cleaner up to 1 bedroom, two cleaners from 2 bedrooms. All cleaning products and equipment (hoover, mop, cloths) are brought by the team and are included in the price.',
  pricing_presets = $json$[{"id":"4f57e359-079e-48d4-8b8b-73b6f2eb4dcc","label":"Studio · 1 bath","sort_order":10,"fixed_price":194,"partner_cost":130,"pricing_mode":"fixed"},{"id":"24128e9a-a7eb-427e-b917-bd7183eabf87","label":"1 bed · 1 bath","sort_order":20,"fixed_price":194,"partner_cost":130,"pricing_mode":"fixed"},{"id":"db2e9b02-7f4b-4ee4-847c-7ff4a66feb47","label":"2 bed · 1 bath","sort_order":30,"fixed_price":237,"partner_cost":156,"pricing_mode":"fixed"},{"id":"3f3c9324-d750-4b63-ba9e-bc611e8c296d","label":"2 bed · 2 bath","sort_order":40,"fixed_price":279,"partner_cost":182,"pricing_mode":"fixed"},{"id":"03026a9e-74b4-49c7-8e11-53eace35b667","label":"3 bed · 1 bath","sort_order":50,"fixed_price":289,"partner_cost":187,"pricing_mode":"fixed"},{"id":"f97363f5-001d-491d-ba8e-7eaeca0b7d96","label":"3 bed · 2 bath","sort_order":60,"fixed_price":331,"partner_cost":213,"pricing_mode":"fixed"},{"id":"5cd67932-b753-4d93-90df-f9d3eb252885","label":"4 bed · 2 bath","sort_order":70,"fixed_price":398,"partner_cost":253,"pricing_mode":"fixed"},{"id":"ced932e6-eef7-4620-8743-80fa10178b61","label":"5 bed · 3 bath","sort_order":80,"fixed_price":516,"partner_cost":324,"pricing_mode":"fixed"}]$json$::jsonb,
  pricing_addons = $json$[{"id":"d89e7a83-b477-4c03-bd34-147f4dd9bbcd","label":"Extra bathroom, 2nd","sort_order":0,"fixed_price":42,"partner_cost":26},{"id":"de1c20cb-213c-46d9-849a-13ea8a04399c","label":"Extra bathroom, 3rd","sort_order":10,"fixed_price":52,"partner_cost":31},{"id":"b904e10c-2f76-4717-a2e7-59640bc1e3da","label":"Extra bathroom, 4th","sort_order":20,"fixed_price":66,"partner_cost":40},{"id":"7af810fa-9552-4f7b-b17c-8550e6dc834b","label":"Extra room (office, dining, utility)","sort_order":30,"fixed_price":42,"partner_cost":26},{"id":"413dfb6c-7215-4349-8449-758898d92299","label":"Carpet steam clean (per room)","sort_order":40,"fixed_price":38,"partner_cost":23},{"id":"b5da987a-5f2f-4205-b26d-e8f02d7894fe","label":"Fridge freezer","sort_order":50,"fixed_price":43,"partner_cost":26},{"id":"1e3470ad-33b8-4b06-a398-e882cd8e5a2b","label":"Windows outside","sort_order":60,"fixed_price":35,"partner_cost":21},{"id":"79225e07-e556-4794-bd56-9f1257f9abb1","label":"Balcony, terrace or patio","sort_order":70,"fixed_price":57,"partner_cost":34},{"id":"111d4bde-e7e2-458b-a48a-bbe02bbfe627","label":"No free parking","sort_order":80,"fixed_price":14,"partner_cost":14},{"id":"2ce17ec0-a108-49b9-ae66-8842acedaf85","label":"Congestion charge","sort_order":90,"fixed_price":18,"partner_cost":18},{"id":"861ac00e-4c80-4d08-b2be-6de824d6ae39","label":"Rug","sort_order":100,"fixed_price":28,"partner_cost":17},{"id":"5f7101a2-461c-4046-8cac-f92a793366a5","label":"Curtains","sort_order":110,"fixed_price":43,"partner_cost":26},{"id":"a123a617-99f9-46a0-a4c3-5d48ed09c52a","label":"2 seater sofa","sort_order":120,"fixed_price":38,"partner_cost":23},{"id":"84f1ce0a-bb72-4bd2-902e-34a2ace29fce","label":"3 seater sofa","sort_order":130,"fixed_price":42,"partner_cost":25},{"id":"82ddcbcc-3a4b-42c3-a1a8-2f9362bd4ebf","label":"4 seater sofa","sort_order":140,"fixed_price":47,"partner_cost":28},{"id":"16e2d04d-3ecb-46da-931a-1a06306d7623","label":"L-shaped sofa 3 seats","sort_order":150,"fixed_price":52,"partner_cost":31},{"id":"6d8ef4a8-02ca-4cb9-9e4e-9e33dcf0438e","label":"L-shaped sofa 4 seats","sort_order":160,"fixed_price":71,"partner_cost":43},{"id":"8b9c9901-2742-47a5-944f-0baa61f61372","label":"L-shaped sofa 5 seats","sort_order":170,"fixed_price":85,"partner_cost":51},{"id":"a5b304bc-181a-4330-9422-16edc873a554","label":"Mattress single","sort_order":180,"fixed_price":23,"partner_cost":14},{"id":"e2ae4c71-1675-4ba5-bfd5-1cf01a4813ff","label":"Mattress double","sort_order":190,"fixed_price":33,"partner_cost":20},{"id":"4961def2-f7e7-49c8-be36-80478791fba6","label":"Mattress king","sort_order":200,"fixed_price":43,"partner_cost":26},{"id":"26448e35-54d7-4cf0-ac3c-88c6d4f7f802","label":"Blinds roman","sort_order":210,"fixed_price":38,"partner_cost":23},{"id":"37ea04ab-31a0-4ba3-9bb6-d69a790a15eb","label":"Blinds venetian","sort_order":220,"fixed_price":12,"partner_cost":7}]$json$::jsonb,
  updated_at = now()
where name = 'Deep Clean';

-- After Builders Clean: 8 faixas, 23 add-ons
update service_catalog set
  is_active = true,
  sort_order = 30,
  pricing_mode = 'fixed',
  fixed_price = 227,
  hourly_rate = 0,
  default_hours = 1,
  partner_cost = 140,
  default_description = 'Property after building or refit work. Fine dust off every surface, skirting, frames and inside windows, paint specks and grout residue where they come away safely, kitchen and bathrooms descaled, hoovering and mopping. One cleaner up to 1 bedroom, two cleaners from 2 bedrooms. All cleaning products and equipment (hoover, mop, cloths) are brought by the team and are included in the price.',
  pricing_presets = $json$[{"id":"866b6b01-272d-4d22-bc45-c78117dae32f","label":"Studio · 1 bath","sort_order":10,"fixed_price":227,"partner_cost":140,"pricing_mode":"fixed"},{"id":"58c779d2-cf60-4dc5-b74b-521b5e349565","label":"1 bed · 1 bath","sort_order":20,"fixed_price":227,"partner_cost":140,"pricing_mode":"fixed"},{"id":"15d6a954-b9cc-417c-908b-f54dc0938468","label":"2 bed · 1 bath","sort_order":30,"fixed_price":269,"partner_cost":166,"pricing_mode":"fixed"},{"id":"8a493ea1-27c7-46cd-b5bf-9062cd339a7b","label":"2 bed · 2 bath","sort_order":40,"fixed_price":311,"partner_cost":192,"pricing_mode":"fixed"},{"id":"e001d318-e411-4bc2-9d89-ee5c9d4def96","label":"3 bed · 1 bath","sort_order":50,"fixed_price":322,"partner_cost":197,"pricing_mode":"fixed"},{"id":"855518f3-f240-4547-8564-480000a41d83","label":"3 bed · 2 bath","sort_order":60,"fixed_price":364,"partner_cost":223,"pricing_mode":"fixed"},{"id":"5bb98b40-0916-4509-a9f8-e42b4225d48f","label":"4 bed · 2 bath","sort_order":70,"fixed_price":430,"partner_cost":263,"pricing_mode":"fixed"},{"id":"3e5a0216-38a0-4873-b669-3b67faf75630","label":"5 bed · 3 bath","sort_order":80,"fixed_price":549,"partner_cost":334,"pricing_mode":"fixed"}]$json$::jsonb,
  pricing_addons = $json$[{"id":"6920bc60-49f2-4e3c-998d-62b649af60be","label":"Extra bathroom, 2nd","sort_order":0,"fixed_price":42,"partner_cost":26},{"id":"69c21615-4496-4136-93e1-8cad77f56209","label":"Extra bathroom, 3rd","sort_order":10,"fixed_price":52,"partner_cost":31},{"id":"597227ea-0fe1-4a5f-a41b-46155dbda03a","label":"Extra bathroom, 4th","sort_order":20,"fixed_price":66,"partner_cost":40},{"id":"7af810fa-9552-4f7b-b17c-8550e6dc834b","label":"Extra room (office, dining, utility)","sort_order":30,"fixed_price":42,"partner_cost":26},{"id":"413dfb6c-7215-4349-8449-758898d92299","label":"Carpet steam clean (per room)","sort_order":40,"fixed_price":38,"partner_cost":23},{"id":"b5da987a-5f2f-4205-b26d-e8f02d7894fe","label":"Fridge freezer","sort_order":50,"fixed_price":43,"partner_cost":26},{"id":"1e3470ad-33b8-4b06-a398-e882cd8e5a2b","label":"Windows outside","sort_order":60,"fixed_price":35,"partner_cost":21},{"id":"79225e07-e556-4794-bd56-9f1257f9abb1","label":"Balcony, terrace or patio","sort_order":70,"fixed_price":57,"partner_cost":34},{"id":"111d4bde-e7e2-458b-a48a-bbe02bbfe627","label":"No free parking","sort_order":80,"fixed_price":14,"partner_cost":14},{"id":"2ce17ec0-a108-49b9-ae66-8842acedaf85","label":"Congestion charge","sort_order":90,"fixed_price":18,"partner_cost":18},{"id":"861ac00e-4c80-4d08-b2be-6de824d6ae39","label":"Rug","sort_order":100,"fixed_price":28,"partner_cost":17},{"id":"5f7101a2-461c-4046-8cac-f92a793366a5","label":"Curtains","sort_order":110,"fixed_price":43,"partner_cost":26},{"id":"a123a617-99f9-46a0-a4c3-5d48ed09c52a","label":"2 seater sofa","sort_order":120,"fixed_price":38,"partner_cost":23},{"id":"84f1ce0a-bb72-4bd2-902e-34a2ace29fce","label":"3 seater sofa","sort_order":130,"fixed_price":42,"partner_cost":25},{"id":"82ddcbcc-3a4b-42c3-a1a8-2f9362bd4ebf","label":"4 seater sofa","sort_order":140,"fixed_price":47,"partner_cost":28},{"id":"16e2d04d-3ecb-46da-931a-1a06306d7623","label":"L-shaped sofa 3 seats","sort_order":150,"fixed_price":52,"partner_cost":31},{"id":"6d8ef4a8-02ca-4cb9-9e4e-9e33dcf0438e","label":"L-shaped sofa 4 seats","sort_order":160,"fixed_price":71,"partner_cost":43},{"id":"8b9c9901-2742-47a5-944f-0baa61f61372","label":"L-shaped sofa 5 seats","sort_order":170,"fixed_price":85,"partner_cost":51},{"id":"a5b304bc-181a-4330-9422-16edc873a554","label":"Mattress single","sort_order":180,"fixed_price":23,"partner_cost":14},{"id":"e2ae4c71-1675-4ba5-bfd5-1cf01a4813ff","label":"Mattress double","sort_order":190,"fixed_price":33,"partner_cost":20},{"id":"4961def2-f7e7-49c8-be36-80478791fba6","label":"Mattress king","sort_order":200,"fixed_price":43,"partner_cost":26},{"id":"26448e35-54d7-4cf0-ac3c-88c6d4f7f802","label":"Blinds roman","sort_order":210,"fixed_price":38,"partner_cost":23},{"id":"37ea04ab-31a0-4ba3-9bb6-d69a790a15eb","label":"Blinds venetian","sort_order":220,"fixed_price":12,"partner_cost":7}]$json$::jsonb,
  updated_at = now()
where name = 'After Builders Clean';

-- General Maintenance: 3 faixas, 0 add-ons
update service_catalog set
  is_active = true,
  sort_order = 40,
  pricing_mode = 'hourly',
  fixed_price = 0,
  hourly_rate = 72,
  default_hours = 1,
  partner_cost = 40,
  default_description = 'Repairs and odd jobs by the hour, half day or full day. Every tool and basic fixings come with the handyman. Materials and parts are not included: quoted separately or supplied by the customer. No gas, certified electrical or structural work.',
  pricing_presets = $json$[{"id":"6be29617-d739-4b46-bb33-a91335391d06","label":"Hourly (min 1 hour)","sort_order":10,"hourly_rate":72,"partner_cost":40,"pricing_mode":"hourly","default_hours":1},{"id":"3ab2a419-3d0a-48d0-8c89-5fc0e9a56f2c","label":"Half day (up to 3.5 hours)","sort_order":20,"fixed_price":180,"partner_cost":117,"pricing_mode":"fixed","default_hours":3.5},{"id":"e93e56aa-b3ae-461b-912e-cd6a0acb8b3a","label":"Full day (up to 7 hours)","sort_order":30,"fixed_price":329,"partner_cost":214,"pricing_mode":"fixed","default_hours":7}]$json$::jsonb,
  pricing_addons = $json$[]$json$::jsonb,
  updated_at = now()
where name = 'General Maintenance';

-- Painter: 3 faixas, 1 add-ons
update service_catalog set
  is_active = true,
  sort_order = 50,
  pricing_mode = 'fixed',
  fixed_price = 215,
  hourly_rate = 0,
  default_hours = 3.5,
  partner_cost = 95,
  default_description = 'Filling, touch-ups and full repaints. Brushes, rollers, sheets and tools included. Paint and materials are quoted as the materials pack or supplied by the customer.',
  pricing_presets = $json$[{"id":"f54482d9-a4a3-4ef5-9996-affe50b890b2","label":"Touch-ups (up to 3.5 hours)","sort_order":10,"fixed_price":215,"partner_cost":95,"pricing_mode":"fixed","default_hours":3.5},{"id":"4d6956f7-ad47-4340-9d22-5ef53c7d92f8","label":"A room, walls, two coats","sort_order":20,"fixed_price":450,"partner_cost":230,"pricing_mode":"fixed","default_hours":7},{"id":"4dad8de8-3559-4a2a-9733-3851a8358702","label":"Full day (up to 7 hours)","sort_order":30,"fixed_price":465,"partner_cost":240,"pricing_mode":"fixed","default_hours":7}]$json$::jsonb,
  pricing_addons = $json$[{"id":"9314d4a4-cdc5-4166-9e54-32bc21f207dc","label":"Paint and materials pack","sort_order":0,"fixed_price":130,"partner_cost":100}]$json$::jsonb,
  updated_at = now()
where name = 'Painter';

-- Electrical Safety Report: 6 faixas, 0 add-ons
update service_catalog set
  is_active = true,
  sort_order = 60,
  pricing_mode = 'fixed',
  fixed_price = 129,
  hourly_rate = 0,
  default_hours = 2,
  partner_cost = 69,
  default_description = '(EICR) Electrical Installation Condition Report',
  pricing_presets = $json$[{"id":"4a866019-ba5b-4c3c-bc81-03c0c1a31d25","label":"EICR studio (up to 8 circuits)","sort_order":10,"fixed_price":129,"partner_cost":69,"pricing_mode":"fixed"},{"id":"327b0fb9-e674-4875-a90b-6ac301e56571","label":"EICR 1 bed (up to 8 circuits)","sort_order":20,"fixed_price":129,"partner_cost":69,"pricing_mode":"fixed"},{"id":"5c8d7114-9ae6-4fbc-8663-ea9de3698db7","label":"EICR 2 bed (up to 8 circuits)","sort_order":30,"fixed_price":165,"partner_cost":99,"pricing_mode":"fixed"},{"id":"c51c4103-8643-4774-ab70-09a8bb5d47b7","label":"EICR 3 bed (up to 10 circuits)","sort_order":40,"fixed_price":195,"partner_cost":99,"pricing_mode":"fixed"},{"id":"86059ae2-fdcb-42ab-8304-c9088c6e55b4","label":"EICR 4 bed (up to 12 circuits)","sort_order":50,"fixed_price":225,"partner_cost":139,"pricing_mode":"fixed"},{"id":"f5ab5067-e1fc-4bf7-b9ec-73c6e1050f51","label":"EICR 5-6 bed (up to 14 circuits)","sort_order":60,"fixed_price":265,"partner_cost":165,"pricing_mode":"fixed"}]$json$::jsonb,
  pricing_addons = $json$[]$json$::jsonb,
  updated_at = now()
where name = 'Electrical Safety Report';

-- Gas Safety Certificate: 4 faixas, 0 add-ons
update service_catalog set
  is_active = true,
  sort_order = 70,
  pricing_mode = 'fixed',
  fixed_price = 79,
  hourly_rate = 0,
  default_hours = 2,
  partner_cost = 60,
  default_description = null,
  pricing_presets = $json$[{"id":"47b785b6-3386-41e1-9275-148a6365e54e","label":"CP12, 1 appliance","sort_order":10,"fixed_price":79,"partner_cost":60,"pricing_mode":"fixed"},{"id":"946c83a7-1e5f-4450-9f99-222df69381f4","label":"CP12, 2 appliances","sort_order":20,"fixed_price":89,"partner_cost":65,"pricing_mode":"fixed"},{"id":"414937bf-d5cc-470e-b687-165e17b4495e","label":"CP12, 3 appliances","sort_order":30,"fixed_price":99,"partner_cost":72,"pricing_mode":"fixed"},{"id":"57690db3-1d21-4dcc-ae93-b30d6dbae374","label":"CP12, 4 appliances","sort_order":40,"fixed_price":109,"partner_cost":80,"pricing_mode":"fixed"}]$json$::jsonb,
  pricing_addons = $json$[]$json$::jsonb,
  updated_at = now()
where name = 'Gas Safety Certificate';

-- Energy Performance Certificate: 6 faixas, 0 add-ons
update service_catalog set
  is_active = true,
  sort_order = 80,
  pricing_mode = 'fixed',
  fixed_price = 95,
  hourly_rate = 0,
  default_hours = 1,
  partner_cost = 60,
  default_description = 'Accredited domestic energy assessor visits, rates the property and lodges the EPC on the national register. Valid for 10 years.',
  pricing_presets = $json$[{"id":"d333dc5f-391c-4317-a17a-c88d1762390e","label":"EPC studio","sort_order":10,"fixed_price":95,"partner_cost":60,"pricing_mode":"fixed"},{"id":"e7752649-6de3-49a2-a464-c2a99ee934d1","label":"EPC 1 bed","sort_order":20,"fixed_price":95,"partner_cost":60,"pricing_mode":"fixed"},{"id":"927dcc71-b033-4003-b377-9a59334d0fc2","label":"EPC 2 bed","sort_order":30,"fixed_price":95,"partner_cost":60,"pricing_mode":"fixed"},{"id":"0399ef34-6ad4-41a8-a025-4a0f62183c7d","label":"EPC 3 bed","sort_order":40,"fixed_price":99,"partner_cost":60,"pricing_mode":"fixed"},{"id":"6089da2f-5a1b-455d-89e9-678c57a2bca1","label":"EPC 4 bed","sort_order":50,"fixed_price":109,"partner_cost":60,"pricing_mode":"fixed"},{"id":"68350fbf-1bed-4377-b05c-4ff95159559c","label":"EPC 5+ bed","sort_order":60,"fixed_price":130,"partner_cost":60,"pricing_mode":"fixed"}]$json$::jsonb,
  pricing_addons = $json$[]$json$::jsonb,
  updated_at = now()
where name = 'Energy Performance Certificate';

-- Standby: desativado, nada apagado. /api/jobs so casa servico ativo, entao
-- job dessas plataformas com esses tipos passa a falhar ate alguem reativar.
update service_catalog set is_active = false, sort_order = 900, updated_at = now()
where name in ('Appliance Testing', 'Boiler Service', 'Carpenter', 'Plumber', 'Electrician', 'Builder', 'Asbestos Management Survey', 'Fire Risk Assessment', 'Gardener', 'Handyman | Half Day', 'Handyman | Day Rate');
