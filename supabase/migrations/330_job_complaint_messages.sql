-- Journal da reclamação (dono, 15/10/2026): conversa contínua entre o escritório e o
-- parceiro sobre uma reclamação, com fotos, registrada no job. Aparece no journal da aba
-- Complaint do OS e na gaveta do job no portal do parceiro.
create table if not exists public.job_complaint_messages (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.jobs(id) on delete cascade,
  author              text not null check (author in ('partner', 'office')),
  author_name         text,
  body                text,
  photos              text[] not null default '{}',
  visible_to_partner  boolean not null default true,
  created_by          uuid,
  created_at          timestamptz not null default now()
);

create index if not exists job_complaint_messages_job_idx on public.job_complaint_messages (job_id, created_at);

alter table public.job_complaint_messages enable row level security;
-- Leitura e escrita só pelo servidor (OS e portal usam service role nas rotas).

notify pgrst, 'reload schema';
