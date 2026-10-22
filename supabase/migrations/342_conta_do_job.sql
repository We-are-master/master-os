-- =============================================================================
-- Migration 342: o job tem a própria conta · 22/10/2026
-- =============================================================================
--
-- Até aqui o job chegava à conta pelo cliente (clients.source_account_id). Um
-- cliente não podia ter jobs em contas diferentes, e trocar a conta do cliente
-- movia o histórico inteiro dele. O contorno era duplicar a pessoa: em
-- 22/10/2026 eram 18 pessoas (mesmo telefone) cadastradas em mais de uma conta.
--
-- Agora:
--   - jobs.account_id congela a conta de hoje de cada job (backfill pelo
--     cliente, que é exatamente o que as telas mostram hoje);
--   - todo job novo recebe a conta do cliente no insert quando vier sem ela
--     (todas as entradas de hoje criam o cliente dentro da conta que contrata,
--     então nada muda), e quem souber a conta de quem contrata passa a mandar;
--   - trocar a conta do cliente não mexe mais em job nenhum;
--   - quotes.source_account_id passa a ser preenchida também quando há cliente.
--
-- Leitura: as telas e relatórios continuam pelo cliente até a virada; a
-- coluna nova é a fonte para os processos novos.
-- Idempotente.

alter table public.jobs
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

update public.jobs j
   set account_id = c.source_account_id
  from public.clients c
 where c.id = j.client_id
   and j.account_id is null
   and c.source_account_id is not null;

create index if not exists jobs_account_id_idx on public.jobs (account_id) where deleted_at is null;

create or replace function public.jobs_conta_do_cliente()
returns trigger
language plpgsql
as $$
begin
  if new.account_id is null and new.client_id is not null then
    select c.source_account_id into new.account_id from public.clients c where c.id = new.client_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_conta_do_cliente on public.jobs;
create trigger trg_jobs_conta_do_cliente
  before insert on public.jobs
  for each row execute function public.jobs_conta_do_cliente();

update public.quotes q
   set source_account_id = c.source_account_id
  from public.clients c
 where c.id = q.client_id
   and q.source_account_id is null
   and c.source_account_id is not null;

comment on column public.jobs.account_id is
  'Conta que contratou este job (quem paga e cujas regras valem). Não muda quando a conta do cliente muda. Migration 342.';
