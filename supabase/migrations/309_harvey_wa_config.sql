-- 309 · Harvey no WhatsApp: interruptor de pausa na mão da equipe
--
-- O Zendesk trava o ticket enquanto o Harvey está com a conversa ("AI agent
-- ticket, can't be edited"), então ninguém consegue responder por lá. A tela
-- /harvey-whatsapp do OS assume uma conversa (passa para o Agent Workspace e
-- destrava o ticket) ou pausa o Harvey inteiro: com pausa, toda mensagem nova
-- vai direto para a equipe.

create table if not exists public.harvey_wa_config (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

insert into public.harvey_wa_config (chave, valor) values ('pausado', 'false'::jsonb) on conflict (chave) do nothing;

alter table public.harvey_wa_config enable row level security;
drop policy if exists "harvey_wa_config_staff" on public.harvey_wa_config;
create policy "harvey_wa_config_staff" on public.harvey_wa_config
  for all to authenticated using (public.is_internal_staff()) with check (public.is_internal_staff());
