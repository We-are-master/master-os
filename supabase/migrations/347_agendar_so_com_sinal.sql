-- =============================================================================
-- Migration 347: Scheduled só com parceiro, data e sinal (conta direct v2) · 22/10/2026
-- =============================================================================
--
-- Plano de processos do dono (22/10/2026), etapa 4: no fluxo direto da Fixfy um
-- job só entra em Scheduled com parceiro, data confirmada e sinal pago. Pagamento
-- completo (finance_status = paid, a reserva do site que nasce paga) dispensa o
-- sinal.
--
-- Só vale para conta com process_type = 'direct' e process_rules->>'v2' = 'true'
-- (e sem process_rules->>'schedule_requires_deposit' = 'false'). Nenhuma conta tem
-- v2 ligado hoje, então nada muda em produção até alguém ligar conta por conta.
--
-- Barra só a ENTRADA em Scheduled (insert já em scheduled, ou update vindo de
-- outro status). Job que já está em Scheduled não é barrado por outra edição.
-- A conta do job é jobs.account_id (migration 342), senão a do cliente.
--
-- A mesma regra mora em src/lib/processo/agendamento.ts (podeAgendar), para a
-- tela explicar antes de tentar. Se mudar um, mude o outro.
--
-- Idempotente.
-- =============================================================================

create or replace function public.job_agendar_so_com_sinal() returns trigger
language plpgsql as $$
declare
  v_conta uuid;
  v_tipo text;
  v_regras jsonb;
  v_falta text[] := '{}';
  v_lista text;
begin
  if new.status is distinct from 'scheduled' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'scheduled' then
    return new;
  end if;
  if new.deleted_at is not null then
    return new;
  end if;

  v_conta := new.account_id;
  if v_conta is null and new.client_id is not null then
    select c.source_account_id into v_conta from public.clients c where c.id = new.client_id;
  end if;
  if v_conta is null then
    return new;
  end if;

  select a.process_type, coalesce(a.process_rules, '{}'::jsonb) into v_tipo, v_regras
    from public.accounts a where a.id = v_conta;
  if v_tipo is distinct from 'direct'
     or coalesce(v_regras->>'v2', '') <> 'true'
     or coalesce(v_regras->>'schedule_requires_deposit', '') = 'false' then
    return new;
  end if;

  if new.partner_id is null then
    v_falta := v_falta || 'a partner'::text;
  end if;
  if new.scheduled_date is null and new.scheduled_start_at is null then
    v_falta := v_falta || 'a confirmed date'::text;
  end if;
  if coalesce(new.finance_status, new.payment_status, '') <> 'paid'
     and coalesce(new.customer_deposit_paid, false) = false then
    v_falta := v_falta || 'the deposit paid'::text;
  end if;

  if array_length(v_falta, 1) is null then
    return new;
  end if;

  if array_length(v_falta, 1) = 1 then
    v_lista := v_falta[1];
  else
    v_lista := array_to_string(v_falta[1:array_length(v_falta, 1) - 1], ', ') || ' and ' || v_falta[array_length(v_falta, 1)];
  end if;

  raise exception '% cannot be scheduled yet: it needs %.', coalesce(new.reference, 'This job'), v_lista
    using errcode = 'check_violation',
          hint = 'Assign a partner, confirm the date and take the deposit (or full payment) before moving the job to Scheduled.';
end;
$$;

drop trigger if exists trg_job_agendar_so_com_sinal on public.jobs;
create trigger trg_job_agendar_so_com_sinal
  before insert or update of status on public.jobs
  for each row execute function public.job_agendar_so_com_sinal();

comment on function public.job_agendar_so_com_sinal() is
  'Conta direct com process_rules.v2: Scheduled só com parceiro, data confirmada e sinal (ou pagamento completo). Migration 347.';
