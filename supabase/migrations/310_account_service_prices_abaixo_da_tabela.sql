-- 310 · Preço combinado de conta pode ficar abaixo da tabela
--
-- O OS cobra de uma conta no mínimo o catálogo: `resolveAccountSell` devolve
-- o maior entre a tabela e o preço da conta (PR #462). Para conta que é
-- parceira de revenda isso esconde o combinado: a U R Certified paga a lista
-- de 04/09 (EoT de 3 quartos a £306), a tabela subiu em 22/09 (£360), e o OS
-- guardava £306 e cobrava £360 sem avisar ninguém.
--
-- Com a chave ligada na linha da conta, o combinado vale mesmo abaixo da
-- tabela, no preço base, nas faixas (preset_overrides) e nos extras
-- (addon_overrides). Sem a chave, nada muda: o piso continua valendo.
--
-- Pode rodar antes do deploy: coluna nova com padrão false, que ninguém lê
-- ainda. O /api/jobs novo pede esta coluna, então ela tem que existir antes
-- dele.

alter table public.account_service_prices
  add column if not exists allow_below_standard boolean not null default false;

comment on column public.account_service_prices.allow_below_standard is
  'Preço combinado abaixo da tabela: com true, fixed_price, hourly_rate, preset_overrides e addon_overrides valem mesmo menores que o catálogo. Só tem efeito com use_standard = false.';
