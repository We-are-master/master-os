-- A ordem do dia decidida À MÃO no modo rota do Live View (arrastar paradas).
-- NULL = ninguém decidiu; vale a otimização de rota / horário de chegada.
-- Com valor, essa ordem manda em: painel de rota, numeração do mapa e o
-- email das 17h do parceiro (que então PULA o otimizador).
--
-- Colar no SQL editor do Supabase, como a 281.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS route_seq smallint;

COMMENT ON COLUMN public.jobs.route_seq IS
  'Manual day-route position (1-based) set by dragging stops in Live View; NULL = automatic order.';
