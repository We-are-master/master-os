-- Relatório por visita (19/10/2026): cada visita extra (V2, V3…) tem o seu, com
-- link próprio para o parceiro dela. A visita 1 continua nos campos do job.
alter table public.job_visits
  add column if not exists start_report jsonb,
  add column if not exists final_report jsonb,
  add column if not exists report_submitted_at timestamptz,
  add column if not exists report_approved_at timestamptz,
  add column if not exists report_approved_by uuid;
