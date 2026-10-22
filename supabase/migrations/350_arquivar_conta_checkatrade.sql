-- 350: a conta "Checkatrade" (leads que pagam direto) é arquivada.
--
-- Decisão do dono em 22/10/2026: lead comprado no Checkatrade é cliente da conta
-- Fixfy, e "checkatrade" passa a ser só a origem do lead (first_source / source).
-- A Express continua sendo a única conta Checkatrade (plataforma).
--
-- Em 22/10 a conta tinha 165 clientes, 20 jobs (todos concluídos ou cancelados),
-- 0 quotes e 19 faturas (13 pagas, 6 canceladas). O robô do Ruben já grava lead
-- novo na conta Fixfy. Nada é apagado: a conta fica inactive com deleted_at.

begin;

-- Origem antes de trocar a conta, para não perder de onde veio.
update public.clients
   set first_source = 'checkatrade'
 where source_account_id = '8060fcf3-a538-4e5a-9318-1b49ee59f432'
   and first_source is null;

update public.clients
   set source_account_id = '5cf896ec-ee42-441b-a698-34fdaeeb28b3'
 where source_account_id = '8060fcf3-a538-4e5a-9318-1b49ee59f432';

update public.jobs
   set source = 'checkatrade'
 where account_id = '8060fcf3-a538-4e5a-9318-1b49ee59f432'
   and source is null;

update public.jobs
   set account_id = '5cf896ec-ee42-441b-a698-34fdaeeb28b3'
 where account_id = '8060fcf3-a538-4e5a-9318-1b49ee59f432';

update public.quotes
   set source = coalesce(source, 'checkatrade'),
       source_account_id = '5cf896ec-ee42-441b-a698-34fdaeeb28b3'
 where source_account_id = '8060fcf3-a538-4e5a-9318-1b49ee59f432';

update public.invoices
   set source_account_id = '5cf896ec-ee42-441b-a698-34fdaeeb28b3'
 where source_account_id = '8060fcf3-a538-4e5a-9318-1b49ee59f432';

update public.accounts
   set status = 'inactive',
       deleted_at = coalesce(deleted_at, now())
 where id = '8060fcf3-a538-4e5a-9318-1b49ee59f432';

commit;
