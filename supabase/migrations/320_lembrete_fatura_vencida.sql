-- Lembrete de fatura vencida (dono, 09/10/2026): 1, 3 e 4 dias depois do vencimento em
-- tom amigável e o 4º, no dia 7, como "final reminder". Um por vez, nunca repete.
alter table public.invoices
  add column if not exists overdue_reminder_stage integer not null default 0,
  add column if not exists overdue_reminder_last_at timestamptz;

-- Plataformas pagam pelo extrato/ciclo delas: sem lembrete automático.
alter table public.accounts
  add column if not exists overdue_reminders boolean not null default true;

update public.accounts set overdue_reminders = false
 where deleted_at is null
   and lower(company_name) in ('housekeep', 'fantastic services', 'checkatrade', 'express');

comment on column public.invoices.overdue_reminder_stage is '0 = nenhum; 1/2/3 = lembretes amigáveis (1, 3, 4 dias); 4 = final reminder (7 dias).';
