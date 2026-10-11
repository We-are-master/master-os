-- Duas contas no Checkatrade (dono, 11/10/2026): o quadro de jobs Express é o mesmo para
-- as duas, então cada Ruben reserva o job aqui ANTES de aceitar. A chave primária é a
-- trava: a primeira conta que reserva leva, a outra pula sem disputar.
create table if not exists public.express_claims (
  external_id text primary key,
  account text not null,
  claimed_at timestamptz not null default now()
);

alter table public.express_claims enable row level security;
