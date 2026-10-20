-- Visitas extras (19/10/2026).
-- 1) Confirmação ao cliente de cada visita extra, uma vez só: trava do envio.
alter table public.job_visits
  add column if not exists client_confirmation_sent_at timestamptz;

-- 2) Visita 1 feita com outra visita pela frente: o job volta para Scheduled com
--    a data da próxima, e a V1 guarda aqui a data e a hora em que foi feita.
--    Formato: { "scheduled_date", "scheduled_start_at", "scheduled_end_at", "done_at" }.
alter table public.jobs
  add column if not exists primary_visit_done jsonb;
