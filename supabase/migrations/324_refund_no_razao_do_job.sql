-- Refund de cliente no razão do job (dono, 13/10/2026).
--
-- O refund entra em `job_payments` como linha NEGATIVA de cliente: a fatura, o
-- "amount due" do job e os painéis do Financeiro somam essas linhas e saem certos
-- sem conhecer refund.
--
-- A tabela nasceu fora das migrations, então não dá para saber daqui se ela tem um
-- CHECK de valor positivo. Se tiver, cai. Se não tiver, este arquivo não faz nada.
do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.job_payments'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ~* 'amount\s*>=?\s*\(?0'
  loop
    execute format('alter table public.job_payments drop constraint %I', c.conname);
  end loop;
end $$;
