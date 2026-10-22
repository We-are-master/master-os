-- Visita por hora ou fixa (dono, 22/10/2026). Cada visita extra diz como é cobrada,
-- igual ao job: Fixed guarda preço do cliente e custo do parceiro (qualquer um pode
-- ser £0); Hourly guarda a taxa por hora de cada lado e, no Done, a chegada, a saída
-- e as horas cobradas (1ª hora mínima, depois de meia em meia hora).
-- client_price / partner_cost continuam sendo o valor final da visita: o gatilho da
-- mig 274 soma isso no total do job e o self-bill do parceiro lê daí.
alter table public.job_visits
  add column if not exists job_type text,
  add column if not exists hourly_client_rate numeric,
  add column if not exists hourly_partner_rate numeric,
  add column if not exists billed_hours numeric,
  add column if not exists arrived_at timestamptz,
  add column if not exists departed_at timestamptz,
  add column if not exists materials_receipts jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_visits_job_type_check') then
    alter table public.job_visits
      add constraint job_visits_job_type_check check (job_type is null or job_type in ('fixed', 'hourly'));
  end if;
end $$;

comment on column public.job_visits.job_type is 'fixed ou hourly. Null = visita antiga, tratada como fixed.';
comment on column public.job_visits.billed_hours is 'Horas cobradas no Done (regra Fixfy: 1h mínima, depois por meia hora).';
comment on column public.job_visits.materials_receipts is 'URLs dos recibos do material comprado nesta visita (bucket job-reports).';
