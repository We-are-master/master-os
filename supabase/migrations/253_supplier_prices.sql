-- O cache de preço de material do orçamentista — com VARIAÇÕES de verdade.
--
-- v3 de 17/08/2026 (v2 refeita a pedido do dono: "trinco de porta" solto não
-- cota nada) — o que existe é trinco 64mm, 76mm e FIRE-RATED (porta de
-- HMO/comunal exige FD30 por lei, e cotar ferragem comum ali é erro de
-- compliance, não só de preço). Cada família carrega suas variantes com
-- `spec` estruturada (tamanho, fire_rated, polegadas da TV, litragem), e o
-- orçamentista escolhe a variante pelo contexto do pedido.
--
-- Preços REAIS da Screwfix (mediana de até 5 produtos por busca, colhidos ao
-- vivo em 17/08/2026). `unit_cost` é FATO; `list_price` é POLÍTICA
-- (markup 1.30, regra do dono: material sempre com 30%). O supplier-RPA renova por TTL (~30d) e
-- recalcula list_price com a margem vigente. Fonte da demanda que escolheu
-- estas famílias: docs/demanda-varredura-2026-08-17.json (905 conversas +
-- 433 jobs classificados — porta interna, flat-pack, TV, EOT e jardim no topo).

create table if not exists supplier_prices (
  id             uuid primary key default gen_random_uuid(),
  -- Família ("door_latch") e variante ("Fire-rated tubular latch 76mm"):
  -- é o par que o orçamentista navega. A busca é a chave de renovação.
  family         text not null,
  variant        text not null,
  query          text not null unique,
  supplier       text not null default 'screwfix',
  unit_cost      numeric(10,2) not null,
  markup         numeric(4,2) not null default 1.30,
  list_price     numeric(10,2) not null,
  -- Atributos estruturados da variante: size_mm, fire_rated, tv_max_in,
  -- litres... é o que permite "TV de 65 polegadas" escolher o suporte certo.
  spec           jsonb not null default '{}'::jsonb,
  sample_product text,
  source_url     text,
  fetched_at     timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (family, variant)
);

comment on table supplier_prices is
  'Cache de preço de material com variantes (orçamentista). unit_cost = fato do fornecedor; list_price = unit_cost x markup (política). spec estruturada escolhe a variante; supplier-RPA renova por TTL.';

create index if not exists supplier_prices_family_idx on supplier_prices (family);

insert into supplier_prices (family, variant, query, unit_cost, markup, list_price, spec, sample_product) values
  ('door_hinge', 'Butt hinge 75mm satin (pair)', 'butt hinge 75mm satin stainless pair', 4.49, 1.30, 5.99, '{"size_mm": 75, "fire_rated": false}'::jsonb, 'Smith & Locke  Polished Chrome Grade 7 Fire Rated Ball Bearing Door Hinges 76mm x 51mm 2 P'),
  ('door_hinge', 'Butt hinge 100mm satin (pair)', 'butt hinge 100mm satin stainless', 7.29, 1.30, 9.99, '{"size_mm": 100, "fire_rated": false}'::jsonb, 'Smith & Locke  Satin Stainless Steel Grade 11 Fire Rated Ball Bearing Hinges 102mm x 76mm '),
  ('door_hinge', 'Fire door hinge grade 13 CE 100mm (pack of 3)', 'fire door hinges grade 13 100mm pack 3', 15.99, 1.30, 20.99, '{"size_mm": 100, "fire_rated": true, "pack": 3}'::jsonb, 'Union PowerLoad Zinc-Plated Left-Handed Grade 13 Fire Rated Lift-Off Hinges 100mm x 88mm 3'),
  ('door_latch', 'Tubular mortice latch 64mm', 'tubular mortice latch 64mm', 3.19, 1.30, 4.99, '{"size_mm": 64, "fire_rated": false}'::jsonb, 'Smith & Locke Chrome Tubular Mortice Latch 64mm Case - 45mm Backset (339PX)'),
  ('door_latch', 'Tubular mortice latch 76mm', 'tubular mortice latch 76mm', 3.99, 1.30, 5.99, '{"size_mm": 76, "fire_rated": false}'::jsonb, 'Smith & Locke Chrome Tubular Mortice Latch 76mm Case - 57mm Backset (322PY)'),
  ('door_latch', 'Fire-rated tubular latch 76mm (FD30/60)', 'fire rated tubular mortice latch 76mm', 3.19, 1.30, 4.99, '{"size_mm": 76, "fire_rated": true}'::jsonb, 'Smith & Locke Chrome Tubular Mortice Latch 76mm Case - 57mm Backset (322PY)'),
  ('door_handle', 'Lever handle on rose satin (pair)', 'lever door handle on rose satin pair', 12.69, 1.30, 16.99, '{"style": "rose", "fire_rated": false}'::jsonb, 'Smith & Locke Bourne Fire Rated Lever on Rose Door Handles Pair Satin Chrome (101HY)'),
  ('door_handle', 'Lever handle on backplate with lock', 'lever lock door handle backplate', 12.99, 1.30, 16.99, '{"style": "backplate-lock"}'::jsonb, 'Smith & Locke Contract Fire Rated Lever Lock Door Handle Pair Satin Anodised Aluminium (20'),
  ('door_handle', 'Fire-rated lever handle (pair)', 'fire rated door handle lever', 12.99, 1.30, 16.99, '{"fire_rated": true}'::jsonb, 'Smith & Locke Corfe Fire Rated Latch Lever Door Handles Pair Polished Chrome (588HY)'),
  ('internal_door', 'White primed 686mm (27")', 'internal door white primed 686mm', 117.99, 1.30, 153.99, '{"width_mm": 686, "fire_rated": false}'::jsonb, 'Green & Taylor  Primed White Wooden Shaker Internal Door 1981mm x 686mm (499CT)'),
  ('internal_door', 'White primed 762mm (30") — padrão', 'internal door white primed 762mm', 127.99, 1.30, 166.99, '{"width_mm": 762, "fire_rated": false}'::jsonb, '4-Clear Light Primed White Wooden Shaker Internal Door 1981mm x 762mm (482FA)'),
  ('internal_door', 'White primed 838mm (33")', 'internal door white primed 838mm', 147.49, 1.30, 191.99, '{"width_mm": 838, "fire_rated": false}'::jsonb, '4-Clear Light Primed White Wooden Shaker Internal Door 1981mm x 838mm (385FA)'),
  ('internal_door', 'Fire door FD30 762mm', 'fire door fd30 762mm', 179.49, 1.30, 233.99, '{"width_mm": 762, "fire_rated": true}'::jsonb, 'Green & Taylor  Satin Painted White Wooden Cottage Internal Fire FD30 Door 1981mm x 762mm '),
  ('internal_door', 'Oak veneer 762mm', 'internal door oak 762mm', 169.49, 1.30, 220.99, '{"width_mm": 762, "finish": "oak"}'::jsonb, 'Green & Taylor  1-Clear Light Satin Lacquered Oak Wooden Traditional Internal Fire Doors w'),
  ('tv_bracket', 'Fixed até 32"', 'tv bracket fixed small', 38.79, 1.30, 50.99, '{"tv_max_in": 32, "type": "fixed"}'::jsonb, 'Sanus  Low-Profile TV Wall Bracket Fixed 47-90" (2390J)'),
  ('tv_bracket', 'Tilt 32–55"', 'tv wall bracket tilt 55 inch', 48.99, 1.30, 63.99, '{"tv_max_in": 55, "type": "tilt"}'::jsonb, 'Sanus QMT35-B2 Universal TV Wall Bracket Tilt 32-55" (161KR)'),
  ('tv_bracket', 'Full-motion 32–55"', 'tv wall bracket full motion 55 inch', 39.99, 1.30, 51.99, '{"tv_max_in": 55, "type": "full-motion"}'::jsonb, 'Ross RTMTA200 TV Bracket Full Motion 23-50" (711YN)'),
  ('tv_bracket', 'Fixed/tilt 55–85"', 'tv wall bracket 85 inch', 49.99, 1.30, 64.99, '{"tv_max_in": 85, "type": "large"}'::jsonb, 'Ross RTMF600 Flat-to-Wall TV Bracket Fixed 50-85" (510YN)'),
  ('sealant', 'Silicone branco (standard)', 'white silicone sealant 310ml', 8.99, 1.30, 11.99, '{"colour": "white"}'::jsonb, 'No Nonsense 820 Sanitary Silicone White 310ml (47187)'),
  ('sealant', 'Silicone transparente', 'clear silicone sealant 310ml', 7.99, 1.30, 10.99, '{"colour": "clear"}'::jsonb, 'Dow 781 Acetoxy Silicone Sealant Clear 310ml (32576)'),
  ('sealant', 'Sanitário HA6 (banheiro)', 'sanitary silicone sealant bathroom', 10.99, 1.30, 14.99, '{"grade": "sanitary"}'::jsonb, 'Unibond  
Kitchen & Bathroom Anti-Mould Sealant White 280ml (219CW)'),
  ('filler', 'Filler pronto (interior)', 'polyfilla ready mixed filler', 12.99, 1.30, 16.99, '{"type": "ready-mixed"}'::jsonb, 'Polycell  Trade Polyfilla All-Purpose Ready Mix Filler White 2kg (29114)'),
  ('filler', 'Wood filler 2 partes', 'two part wood filler high performance', 14.99, 1.30, 19.99, '{"type": "2-part-wood"}'::jsonb, 'Ronseal High Performance Wood Filler White 550g (45077)'),
  ('paint', 'Emulsão branca matt 5L (trade)', 'trade white matt emulsion 5l', 34.39, 1.30, 44.99, '{"finish": "matt", "litres": 5}'::jsonb, 'Dulux Trade Supermatt 5Ltr White Matt Emulsion  Paint (48384)'),
  ('paint', 'Kitchen & bathroom 2.5L', 'kitchen bathroom paint 2.5l', 17.99, 1.30, 23.99, '{"finish": "k&b", "litres": 2.5}'::jsonb, 'Fortress  2.5Ltr Brilliant White Soft Sheen Emulsion Kitchen & Bathroom Paint (637JM)'),
  ('paint', 'Gloss branco 2.5L (madeira)', 'white gloss paint 2.5l wood', 29.24, 1.30, 38.99, '{"finish": "gloss", "litres": 2.5}'::jsonb, 'Dulux Trade 2.5Ltr Pure Brilliant White High Gloss Solvent-Based Trim Paint (83378)'),
  ('blind', 'Veneziana 60cm', 'venetian blind 60cm', 8.99, 1.30, 11.99, '{"width_cm": 60}'::jsonb, 'Renaissance Venetian  Blind Grey 60cm x 150cm Drop (939CK)'),
  ('blind', 'Veneziana 90cm', 'venetian blind 90cm', 12.99, 1.30, 16.99, '{"width_cm": 90}'::jsonb, 'Renaissance Venetian  Blind White 90cm x 150cm Drop (270CK)'),
  ('blind', 'Veneziana 120cm', 'venetian blind 120cm', 16.99, 1.30, 22.99, '{"width_cm": 120}'::jsonb, 'Renaissance Venetian  Blind White 120cm x 150cm Drop (408CK)'),
  ('curtain_pole', 'Extensível 120–210cm', 'extendable curtain pole 210cm', 26.99, 1.30, 35.99, '{"max_cm": 210}'::jsonb, 'Renaissance Antique Brass Curtain Pole 28/25mm x 120-210cm (372CK)'),
  ('curtain_pole', 'Extensível 170–300cm', 'extendable curtain pole 300cm', 38.99, 1.30, 50.99, '{"max_cm": 300}'::jsonb, 'Rothley Brushed Stainless Steel Extendable Curtain Pole w/ Stud Finials 28mm x 165-300cm ('),
  ('shelf_bracket', '150mm (par)', 'shelf bracket 150mm', 10.59, 1.30, 13.99, '{"size_mm": 150}'::jsonb, 'Essentials London Shelf Brackets Grey 200mm x 150mm 20 Pack (416VJ)'),
  ('shelf_bracket', 'Heavy duty 200mm+', 'heavy duty shelf bracket 250mm', 16.79, 1.30, 21.99, '{"size_mm": 250, "duty": "heavy"}'::jsonb, 'Heavy Duty Brackets Black 300mm x 300mm 2 Pack (78941)'),
  ('mdf', '12mm 2440×1220', 'mdf board 12mm 2440', 54.99, 1.30, 71.99, '{"thickness_mm": 12}'::jsonb, 'Essentials Primed MDF Torus Skirting Board 2400mm x 119mm x 18mm 4 Pack (724RE)'),
  ('mdf', '18mm 2440×1220', 'mdf board 18mm 2440', 54.99, 1.30, 71.99, '{"thickness_mm": 18}'::jsonb, 'Essentials Primed MDF Torus Skirting Board 2400mm x 119mm x 18mm 4 Pack (724RE)'),
  ('screws', 'Sortidos (caixa trade)', 'wood screws trade pack assorted', 22.99, 1.30, 29.99, '{"pack": "assorted"}'::jsonb, 'TurboGold  PZ Double-Countersunk Woodscrews Trade Pack 1400 Pcs (40237)'),
  ('paint', 'Emulsão de teto 5L', 'ceiling paint white 5l', 25.99, 1.30, 33.99, '{"finish": "ceiling", "litres": 5}'::jsonb, 'Dulux Walls & Ceilings 5Ltr Pure Brilliant White Matt Emulsion  Paint (22939)'),
  ('paint', 'Primer/undercoat madeira 2.5L', 'wood primer undercoat 2.5l', 23.99, 1.30, 31.99, '{"finish": "primer-wood", "litres": 2.5}'::jsonb, 'Leyland Trade Acrylic 2.5Ltr White Matt  Interior & Exterior Wood Primer Undercoat (64719)'),
  ('paint', 'Verniz madeira interior 750ml', 'interior wood varnish 750ml', 17.99, 1.30, 23.99, '{"finish": "varnish", "litres": 0.75}'::jsonb, 'Ronseal 750ml Clear Satin Water-Based Interior Wood Varnish (551HT)'),
  ('paint', 'Masonry externa 5L', 'masonry paint 5l white', 49.99, 1.30, 64.99, '{"finish": "masonry", "litres": 5}'::jsonb, 'Drybase White Liquid Applied DPM 5Ltr (593CN)'),
  ('paint', 'Tinta de radiador 750ml', 'radiator paint white 750ml', 13.99, 1.30, 18.99, '{"finish": "radiator", "litres": 0.75}'::jsonb, 'Fortress 750ml White Satin Heat Resistant Radiator Paint (376JM)'),
  ('paint_sundries', 'Kit rolo + bandeja', 'paint roller set tray', 6.19, 1.30, 8.99, '{"kind": "roller-set"}'::jsonb, '9" Roller Set 7 Pieces (843FM)'),
  ('paint_sundries', 'Jogo de trinchas', 'paint brush set', 11.99, 1.30, 15.99, '{"kind": "brush-set"}'::jsonb, 'LickTools Paint Brush Set 3 Pieces (724VX)'),
  ('paint_sundries', 'Fita de pintor 48mm', 'masking tape 48mm painters', 7.08, 1.30, 9.99, '{"kind": "masking-tape"}'::jsonb, 'Frogtape  Painters Multi-Surface 21-Day Masking Tape 55m x 48mm (428AY)'),
  ('paint_sundries', 'Lona/dust sheet', 'dust sheet cotton', 10.99, 1.30, 14.99, '{"kind": "dust-sheet"}'::jsonb, 'Cotton Dust Sheet 12'' x 12'' (217FM)'),
  ('plumbing', 'Válvula de enchimento (fill valve)', 'toilet fill valve', 20.58, 1.30, 26.99, '{"part": "fill-valve"}'::jsonb, 'Thomas Dudley Ltd  Bottom-Entry Delay Fill Professional Brass Tail Inlet Valve 1/2" (4777R'),
  ('plumbing', 'Válvula de descarga (flush valve)', 'toilet flush valve', 10.89, 1.30, 14.99, '{"part": "flush-valve"}'::jsonb, 'Fluidmaster   Push Button Cable Dual-Flush Valve (51173)'),
  ('plumbing', 'Assento sanitário (soft close)', 'soft close toilet seat', 27.99, 1.30, 36.99, '{"part": "toilet-seat"}'::jsonb, 'Soft-Close with Quick-Release Toilet Seat Duraplast White (2401K)'),
  ('plumbing', 'Torneira misturadora cozinha', 'kitchen mixer tap', 32.99, 1.30, 42.99, '{"part": "kitchen-tap"}'::jsonb, 'Trebbia Dual-Lever Mono Mixer Kitchen Tap Chrome (9385T)'),
  ('plumbing', 'Torneira de lavatório (par)', 'basin taps pair', 24.99, 1.30, 32.99, '{"part": "basin-taps"}'::jsonb, 'Swirl Traditional Chrome 82mm Cloakroom Cross Head 2 Tap Holes Basin Pillar Tap (88965)'),
  ('plumbing', 'Flexíveis (par)', 'flexible tap connectors 15mm', 4.15, 1.30, 5.99, '{"part": "flexi"}'::jsonb, 'Tesla  Brass Compression Adapting Flexible Tap Connectors 15mm x 3/8" 2 Pack (6089R)'),
  ('plumbing', 'Sifão de pia', 'basin waste trap', 8.49, 1.30, 11.99, '{"part": "trap"}'::jsonb, 'McAlpine Adjustable Inlet Tubular ''P'' Trap White 32mm (89677)'),
  ('plumbing', 'Válvula de isolamento 15mm', 'isolation valve 15mm', 3.55, 1.30, 4.99, '{"part": "iso-valve"}'::jsonb, 'Flomasta Isolating Valves 15mm 10 Pack (32802)'),
  ('plumbing', 'Ducha + mangueira', 'shower head hose set', 39.20, 1.30, 50.99, '{"part": "shower-set"}'::jsonb, 'Hansgrohe Vernis Blend Ecosmart Shower Set Chrome (268VG)'),
  ('electrical', 'Tomada dupla branca', 'double socket white 13a', 10.99, 1.30, 14.99, '{"part": "double-socket"}'::jsonb, 'LAP  13A 2-Gang DP Switched Plug Sockets White   5 Pack (49620)'),
  ('electrical', 'Interruptor simples', 'light switch 1 gang white', 5.39, 1.30, 7.00, '{"part": "switch-1g"}'::jsonb, 'MK Logic Plus 10AX 1-Gang 2-Way Light Switch  White (11822)'),
  ('electrical', 'Pendente/luminária teto', 'ceiling pendant light fitting', 14.99, 1.30, 19.99, '{"part": "pendant"}'::jsonb, 'Knightsbridge  Contemporary Pendant Matt Black (497TY)'),
  ('electrical', 'Lâmpada LED E27 (pack)', 'led bulb e27 pack', 6.98, 1.30, 9.99, '{"part": "led-e27"}'::jsonb, 'Sylvania ToLEDo E27 GLS LED Light Bulb  1521lm 15W 4 Pack (523PP)'),
  ('electrical', 'Alarme de CO', 'carbon monoxide alarm', 25.99, 1.30, 33.99, '{"part": "co-alarm", "compliance": true}'::jsonb, 'FireAngel  FA6813 Battery Standalone Carbon Monoxide Alarm (707KC)'),
  ('fixings', 'Buchas heavy-duty p/ drywall', 'heavy duty plasterboard fixings', 16.99, 1.30, 22.99, '{"part": "plasterboard-heavy"}'::jsonb, 'Bullfix STR-UNI-10 Universal Plasterboard Fixings 24mm x 44mm 10 Pack (172JA)'),
  ('fixings', 'Buchas sortidas parede', 'wall plugs assorted', 9.99, 1.30, 12.99, '{"part": "wall-plugs"}'::jsonb, 'Rawlplug Uno Mixed Wall Plugs 250 Pcs (7574G)'),
  ('fixings', 'Cola grab (No More Nails)', 'grab adhesive no more nails', 8.49, 1.30, 11.99, '{"part": "grab-adhesive"}'::jsonb, 'Evo-Stik Sticks Like Sh*t Solvent-Free Grab Adhesive Clear 290ml (57252)'),
  ('tiling', 'Cola de azulejo rapid-set 20kg', 'tile adhesive ready mixed 10l', 18.29, 1.30, 23.99, '{"part": "tile-adhesive"}'::jsonb, 'No Nonsense  Wall & Floor Rapid Set Tile Adhesive Grey 20kg (799HU)'),
  ('tiling', 'Rejunte impermeável 1.5kg', 'tile grout white 2.5kg', 15.29, 1.30, 19.99, '{"part": "grout"}'::jsonb, 'Mapei  Wall Waterproof Fix & Grout White 1.5kg (64982)'),
  ('garden', 'Painel de cerca closeboard 6×6 (unidade)', 'closeboard fence panel 6ft', 83.33, 1.30, 108.99, '{"part": "fence-panel", "pack_math": "\u00a3249.99/3"}'::jsonb, 'Forest Closeboard 6''x6'' — pack de 3 £249.99 (÷3)'),
  ('garden', 'Poste de cerca 75mm 2.4m (unidade)', 'timber fence post 75mm 2.4m', 11.18, 1.30, 14.99, '{"part": "fence-post", "pack_math": "\u00a3122.98/11"}'::jsonb, 'Forest Timber Posts 75mm 2.4m — pack de 11 £122.98 (÷11)'),
  ('garden', 'Postcrete/PostFix 20kg', 'blue circle postcrete', 7.49, 1.30, 9.99, '{"part": "postcrete"}'::jsonb, 'No Nonsense CP48 PostFix Concrete Grey 20kg (156GL)'),
  ('garden', 'Semente de grama 120m²', 'lawn seed multipurpose', 32.99, 1.30, 42.99, '{"part": "lawn-seed", "coverage_m2": 120}'::jsonb, 'Westland Gro-Sure Multipurpose Lawn Seed 120m2 3.6kg (132KH)'),
  ('electrical', 'Alarme de fumaça (10 anos)', 'smoke alarm', 18.99, 1.30, 24.99, '{"part": "smoke-alarm", "compliance": true}'::jsonb, 'FireAngel FA6620-R Battery Standalone Optical Smoke Alarm (758PV)'),
  ('paint_sundries', 'Lixa sortida (pack 10)', 'sanding sheets assorted pack', 6.99, 1.30, 9.99, '{"kind": "sandpaper"}'::jsonb, 'Essentials 120 Grit Sanding Sheets 10 Pack (820JG)')
on conflict (query) do nothing;
