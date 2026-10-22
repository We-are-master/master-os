-- =============================================================================
-- Migration 346: um job por quote · 22/10/2026
-- =============================================================================
--
-- O aceite da quote (/api/quotes/respond) não conferia o estado: um clique duplo
-- numa quote sem ticket criava dois jobs e dois sinais. A rota agora devolve o
-- primeiro aceite; este índice é a trava para dois aceites no mesmo instante.
-- Conferido em 22/10/2026: nenhuma quote tem mais de um job (10 jobs com quote).
-- Idempotente.

create unique index if not exists jobs_um_por_quote
  on public.jobs (quote_id)
  where quote_id is not null and deleted_at is null;
