-- =============================================================================
-- Migration 341: tipo de processo da conta (direct, platform, b2b) · 22/10/2026
-- =============================================================================
--
-- Plano de processos do dono (22/10/2026), item 1: a conta é quem contrata e
-- dita as regras; o tipo de processo é o processo base. Até aqui "plataforma"
-- era descoberto por UUID no código, pelo nome da conta ou por flags de
-- comportamento. Agora é uma coluna.
--
--   direct    a Fixfy vende direto (Fixfy, Checkatrade de clientes diretos)
--   platform  a plataforma vende e paga a Fixfy (Express, Housekeep, Fantastic)
--   b2b       empresa que contrata por fatura (Li & Fung, Kvadrat, …)
--
-- Backfill pelo UUID, nunca pelo nome (a migration 320 errou pelo nome depois
-- da troca de nomes de 13/10). Conferido no banco em 22/10/2026.
--
-- `process_rules` guarda as exceções da conta ao processo base (por exemplo
-- b2b_human_only, schedule_requires_deposit). Vazio = o padrão do tipo, que
-- mora no código (src/lib/processo/conta.ts).
--
-- Nada aqui muda comportamento: o código só passa a ler a coluna.
-- Idempotente.

alter table public.accounts add column if not exists process_type text;
alter table public.accounts add column if not exists process_rules jsonb not null default '{}'::jsonb;

alter table public.accounts drop constraint if exists accounts_process_type_check;
alter table public.accounts
  add constraint accounts_process_type_check check (process_type in ('direct', 'platform', 'b2b'));

update public.accounts set process_type = 'direct'
 where process_type is null
   and id in ('5cf896ec-ee42-441b-a698-34fdaeeb28b3',  -- Fixfy
              '8060fcf3-a538-4e5a-9318-1b49ee59f432'); -- Checkatrade (clientes diretos)

update public.accounts set process_type = 'platform'
 where process_type is null
   and id in ('38b48520-f116-4263-90e5-8cd5a7d39ecf',  -- Express (Checkatrade Express)
              '9659bbfb-eb56-4a31-9773-7f5e1335d0b4',  -- Housekeep
              '3da39c93-4456-4ab1-9bcc-4e87d9564dbd'); -- Fantastic Services

update public.accounts set process_type = 'b2b' where process_type is null;

alter table public.accounts alter column process_type set default 'b2b';
alter table public.accounts alter column process_type set not null;

comment on column public.accounts.process_type is
  'Processo base da conta: direct (Fixfy vende), platform (a plataforma vende e paga a Fixfy), b2b (empresa por fatura). Migration 341.';
comment on column public.accounts.process_rules is
  'Exceções da conta ao processo base (chaves em src/lib/processo/conta.ts). Vazio = padrão do tipo.';
