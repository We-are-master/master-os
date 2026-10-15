-- 327 · Diário de decisões do Harvey (dono, 15/10/2026)
--
-- Uma linha por decisão que o Harvey tomou: passou a conversa para a equipe,
-- mandou link de pagamento, rascunhou preço a partir dos lances, andou um passo
-- do follow-up de lead. `regra` diz qual regra/lição ele seguiu; `pendente`
-- diz o que ainda está aberto e com quem. O brief das 8h lista as linhas de
-- ontem com `pendente` preenchido e `resolvido_em` vazio.
--
-- Só o servidor escreve (service role). Equipe interna lê.

create table if not exists public.harvey_diario (
  id            uuid primary key default gen_random_uuid(),
  criado_em     timestamptz not null default now(),
  origem        text not null check (origem in ('whatsapp', 'lances', 'followup', 'quotes')),
  ticket_id     bigint,
  quote_ref     text,
  job_ref       text,
  decisao       text not null,
  regra         text not null,
  pendente      text,
  resolvido_em  timestamptz
);

create index if not exists harvey_diario_criado_em_idx on public.harvey_diario (criado_em desc);
create index if not exists harvey_diario_pendente_idx on public.harvey_diario (criado_em desc)
  where pendente is not null and resolvido_em is null;
create index if not exists harvey_diario_ticket_idx on public.harvey_diario (ticket_id) where ticket_id is not null;

alter table public.harvey_diario enable row level security;

drop policy if exists "harvey_diario_staff_read" on public.harvey_diario;
create policy "harvey_diario_staff_read" on public.harvey_diario
  for select to authenticated using (public.is_internal_staff());

comment on table public.harvey_diario is
  'Diário de decisões do Harvey: o que decidiu, por qual regra e o que ficou pendente (e com quem). Lido pelo brief diário das 8h.';
