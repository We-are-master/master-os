-- 353: as mensagens do WhatsApp de operação (+44 7983 182332), para a tela
-- /inbox do OS (dono, 02/11/2026).
--
-- O 7983 está na API oficial em coexistência: o app do celular continua e a
-- Meta manda tudo ao webhook do OS. Não há endpoint de histórico na Cloud API,
-- então só existe aqui o que chegou depois da ligação. Uma linha por mensagem:
--
--   direcao   entrada (o contato escreveu) | saida (nós)
--   origem    contato | celular (eco do app no celular) | os (enviada pela tela)
--   status    sent | delivered | read | failed, pelos status do webhook
--   wamid     o id da Meta; o mesmo evento repetido não duplica
--
-- Escrita só pelo service role (webhook e rota de envio); a equipe lê.

begin;

create table if not exists public.wa_mensagens (
  id uuid primary key default gen_random_uuid(),
  wamid text unique,
  phone_number_id text not null,
  contato text not null,
  contato_nome text,
  direcao text not null check (direcao in ('entrada', 'saida')),
  origem text not null check (origem in ('contato', 'celular', 'os')),
  tipo text not null default 'text',
  texto text,
  midia_id text,
  status text,
  erro text,
  enviado_por uuid,
  enviado_por_nome text,
  partner_id uuid references public.partners(id) on delete set null,
  criado_em timestamptz not null default now(),
  recebido_em timestamptz not null default now(),
  bruto jsonb
);

create index if not exists wa_mensagens_conversa on public.wa_mensagens (phone_number_id, contato, criado_em desc);
create index if not exists wa_mensagens_recentes on public.wa_mensagens (phone_number_id, criado_em desc);

alter table public.wa_mensagens enable row level security;
drop policy if exists "wa_mensagens_staff_read" on public.wa_mensagens;
create policy "wa_mensagens_staff_read" on public.wa_mensagens
  for select to authenticated using (public.is_internal_staff());

commit;
