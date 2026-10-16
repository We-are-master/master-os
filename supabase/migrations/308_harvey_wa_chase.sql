-- 308 · Harvey no WhatsApp: chase de quem parou de responder
--
-- Até 3 lembretes no dia (1h, 4h e 20h depois da última mensagem do cliente),
-- sempre dentro das 24h que o WhatsApp deixa mandar texto livre e fora do
-- horário de dormir de Londres. O Harvey escreve o lembrete com o contexto da
-- conversa, ou decide que não há o que cobrar.

alter table public.harvey_wa_conversas
  add column if not exists cliente_em timestamptz,
  add column if not exists harvey_em timestamptz,
  add column if not exists chases integer not null default 0,
  add column if not exists chase_em timestamptz;

create index if not exists harvey_wa_conversas_chase_idx
  on public.harvey_wa_conversas (cliente_em)
  where estado = 'harvey' and chases < 3;
