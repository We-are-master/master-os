-- =============================================================================
-- Migration 340: job pago não fica em Awaiting payment (dono, 21/10/2026)
-- =============================================================================
--
-- Regra: Awaiting payment é todo job que ainda não foi pago; dali ele só sai pago
-- (Completed, aba Closed) ou perdido (Cancelled). O JOB-9747 foi pago no cartão,
-- fechou sozinho e uma aba antiga o devolveu para Awaiting payment 7 s depois.
-- A tela agora confere antes de escrever; este gatilho é a trava para qualquer
-- outro caminho (outra aba, script, rotina): status Awaiting payment com o
-- pagamento completo vira Completed na hora.
--
-- Idempotente.
-- =============================================================================

create or replace function public.job_pago_fecha_awaiting_payment() returns trigger
language plpgsql as $$
begin
  if new.status = 'awaiting_payment'
     and new.deleted_at is null
     and coalesce(new.finance_status, new.payment_status) = 'paid' then
    new.status := 'completed';
    new.completed_date := coalesce(new.completed_date, (now() at time zone 'Europe/London')::date);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_job_pago_fecha_awaiting_payment on public.jobs;
create trigger trg_job_pago_fecha_awaiting_payment
  before insert or update of status, finance_status, payment_status on public.jobs
  for each row execute function public.job_pago_fecha_awaiting_payment();

-- Quem já está assim hoje (21/10/2026: só o JOB-9747).
update public.jobs
   set status = 'completed',
       completed_date = coalesce(completed_date, (now() at time zone 'Europe/London')::date)
 where status = 'awaiting_payment'
   and deleted_at is null
   and coalesce(finance_status, payment_status) = 'paid';
