-- Fase 0 da automação (dono, 09/10/2026): cada conta diz como paga.
--   invoice      = fatura depois do job pronto, junto com o relatório, vencimento pelo ciclo da conta
--   card_upfront = 50% antes e 50% no fim, no cartão salvo (conta Fixfy / B2C e quem não tem conta)
alter table public.accounts
  add column if not exists collection_mode text not null default 'invoice';

do $$ begin
  alter table public.accounts
    add constraint accounts_collection_mode_check check (collection_mode in ('invoice', 'card_upfront'));
exception when duplicate_object then null; end $$;

comment on column public.accounts.collection_mode is
  'invoice = fatura + relatório no fim do final check; card_upfront = sinal 50% + restante no cartão salvo.';

-- A conta Fixfy recebe as reservas do site e do Harvey (B2C).
update public.accounts set collection_mode = 'card_upfront'
 where deleted_at is null and lower(company_name) = 'fixfy';
