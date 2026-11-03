-- 354: o estado de cada conversa da /inbox (7983) e as views por tag
-- (dono, 03/11/2026).
--
-- inbox_conversas   uma linha por contato. `resolvida_em` fecha a conversa;
--                   ela reabre sozinha quando o contato escreve depois disso
--                   (a tela compara com a última entrada, nada a limpar).
--                   `arquivada_em` tira da caixa e fica no Archived até
--                   alguém desarquivar (contato escrever não traz de volta).
--                   `excluida_em` some da caixa (as mensagens ficam em
--                   wa_mensagens); volta sozinha se o contato escrever depois.
--                   `tags` põe a conversa nas views da lateral. `presenca` e
--                   `presenca_em` vêm do evento de presença da uazapi.
-- inbox_tags        o catálogo das tags: nome e cor. Cada tag é uma view.
-- inbox-media       bucket privado com o que a equipe manda pela tela (foto,
--                   documento, áudio). A uazapi baixa por URL assinada.
--
-- Escrita só pelas rotas do OS (service role); a equipe lê.

begin;

create table if not exists public.inbox_conversas (
  contato text primary key,
  resolvida_em timestamptz,
  resolvida_por uuid,
  arquivada_em timestamptz,
  excluida_em timestamptz,
  tags text[] not null default '{}',
  presenca text,
  presenca_em timestamptz,
  atualizado_em timestamptz not null default now()
);

-- Quem já criou a tabela antes destas colunas.
alter table public.inbox_conversas add column if not exists arquivada_em timestamptz;
alter table public.inbox_conversas add column if not exists excluida_em timestamptz;
-- Lida/não lida e fixada (03/11): a equipe divide o mesmo número, então é por conversa, não por pessoa.
-- `lida_em` zera o contador; `nao_lida` é o "Mark as unread"; `fixada_em` põe no topo da lista.
alter table public.inbox_conversas add column if not exists lida_em timestamptz;
alter table public.inbox_conversas add column if not exists nao_lida boolean not null default false;
alter table public.inbox_conversas add column if not exists fixada_em timestamptz;

create table if not exists public.inbox_tags (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  cor text not null default 'slate',
  criado_em timestamptz not null default now()
);

alter table public.inbox_conversas enable row level security;
alter table public.inbox_tags enable row level security;

drop policy if exists "inbox_conversas_staff_read" on public.inbox_conversas;
create policy "inbox_conversas_staff_read" on public.inbox_conversas
  for select to authenticated using (public.is_internal_staff());

drop policy if exists "inbox_tags_staff_read" on public.inbox_tags;
create policy "inbox_tags_staff_read" on public.inbox_tags
  for select to authenticated using (public.is_internal_staff());

insert into storage.buckets (id, name, public)
values ('inbox-media', 'inbox-media', false)
on conflict (id) do nothing;

commit;
