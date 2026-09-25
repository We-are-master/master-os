-- O parceiro vê quanto pagamos já no passo 1 do /get-started (trade portal) e
-- escolhe entre a tabela padrão e os preços dele (23/09/2026).
--
-- A tabela padrão NÃO mora aqui: é o `partner_cost` de cada faixa do
-- service_catalog. Esta coluna guarda só a escolha e, quando ele recusa o
-- padrão, os números dele:
--   { "version": 1, "updated_at": "...", "services": [
--       { "service_id": "<uuid do catálogo>", "service": "Deep Clean",
--         "kind": "cleaning" | "trade", "accepts_standard": false,
--         "own": { "1 bed · 1 bath": 135, ... } } ] }
-- Limpeza: preço por faixa de tamanho. Handyman e Painter: "Hourly",
-- "Half day (3.5 hours)", "Full day (7 hours)".

alter table public.partners
  add column if not exists rate_card jsonb;

comment on column public.partners.rate_card is
  'Rates chosen at onboarding: standard (service_catalog partner_cost) or own per band. See migration 294.';

notify pgrst, 'reload schema';
