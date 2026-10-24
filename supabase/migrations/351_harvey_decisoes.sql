-- 351: o que o Harvey decidiu em cada ticket, para medir (dono, 24/10/2026).
--
-- No ticket 51747 ele classificou a reclamação certo e pôs o JOB-9781 em hold,
-- mas o ticket ficou em Open e não em Complaint, e nada registrava isso. A tag
-- de classe só entrava nas classes que viram nota; o resto morava em arquivo
-- local do Railway. Agora cada decisão vira uma linha:
--
--   classe        o que ele achou que o ticket é (triagem ou etapa do WhatsApp)
--   acao          o que ele fez (job_criado, hold, nota, cotacao, passou_equipe...)
--   resultado     ok | nota | faltando | falhou
--   status_*      o status do ticket antes, o esperado para a ação e o que ficou
--                 (status_depois é conferido ~10 min depois, pela varredura)
--   humano_*      em 24h alguém da equipe trocou o status pelo painel? É o sinal
--                 de que a decisão estava errada.

begin;

create table if not exists public.harvey_decisoes (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  canal text not null check (canal in ('email', 'whatsapp')),
  ticket_id bigint,
  classe text not null,
  acao text not null,
  resultado text not null check (resultado in ('ok', 'nota', 'faltando', 'falhou')),
  referencia text,
  detalhe text,
  status_antes bigint,
  status_esperado bigint[],
  status_depois bigint,
  status_ok boolean,
  conferido_em timestamptz,
  humano_mudou boolean,
  humano_status bigint,
  conferido_24h_em timestamptz
);

create index if not exists harvey_decisoes_criado_em on public.harvey_decisoes (criado_em desc);
create index if not exists harvey_decisoes_ticket on public.harvey_decisoes (ticket_id);
create index if not exists harvey_decisoes_a_conferir on public.harvey_decisoes (criado_em) where conferido_em is null or conferido_24h_em is null;

alter table public.harvey_decisoes enable row level security;
drop policy if exists "harvey_decisoes_staff_read" on public.harvey_decisoes;
create policy "harvey_decisoes_staff_read" on public.harvey_decisoes
  for select to authenticated using (public.is_internal_staff());

comment on table public.harvey_decisoes is 'Cada decisão do Harvey num ticket: classe, ação, status antes/esperado/depois e se a equipe corrigiu. Migration 351.';

commit;
