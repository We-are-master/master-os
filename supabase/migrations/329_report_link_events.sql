-- Registro do caminho do report do parceiro (dono, 15/10/2026: "link quebrando").
-- Cada abertura, foto enviada, recusa e envio fica aqui, para ver onde trava.
create table if not exists public.report_link_events (
  id          bigint generated always as identity primary key,
  job_id      uuid references public.jobs(id) on delete cascade,
  partner_id  uuid references public.partners(id) on delete set null,
  event       text not null,
  ok          boolean not null default true,
  detail      text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists report_link_events_job_idx on public.report_link_events (job_id, created_at desc);
create index if not exists report_link_events_falhas_idx on public.report_link_events (created_at desc) where ok = false;

alter table public.report_link_events enable row level security;
-- Só o servidor (service role) escreve e lê; o OS mostra pelo servidor.

notify pgrst, 'reload schema';
