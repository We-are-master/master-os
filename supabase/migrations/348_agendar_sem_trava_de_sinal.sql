-- Entrada não trava o agendamento (dono, 22/10/2026): o job pode ir para Scheduled
-- sem o sinal; a equipe acompanha pela pendência Deposit Pending. A trava da 347
-- passa a valer só para conta que liga process_rules.schedule_requires_deposit = true.
-- Só muda a condição de saída da função; o resto é igual à 347.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.job_agendar_so_com_sinal()'::regprocedure) into v_def;
  v_def := replace(
    v_def,
    'or coalesce(v_regras->>''schedule_requires_deposit'', '''') = ''false'' then',
    'or coalesce(v_regras->>''schedule_requires_deposit'', '''') <> ''true'' then'
  );
  if position('<> ''true'' then' in v_def) = 0 then
    raise exception 'job_agendar_so_com_sinal: condição esperada não encontrada';
  end if;
  execute v_def;
end $$;
