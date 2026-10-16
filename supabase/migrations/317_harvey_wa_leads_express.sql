-- 317: o template do Express (07/10/2026) usa a mesma trava de "já falamos" dos
-- leads, e precisa saber de qual job e de qual ticket aquele telefone é: quando o
-- cliente responde, o ticket do job entra no ticket do WhatsApp e o job passa a
-- apontar para a conversa.
alter table public.harvey_wa_leads add column if not exists job_id uuid references public.jobs(id) on delete set null;
alter table public.harvey_wa_leads add column if not exists ticket_id bigint;
alter table public.harvey_wa_leads add column if not exists origem text not null default 'lead';
