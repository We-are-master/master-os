-- Origem do lead nos registros antigos (dono, 22/10/2026). A 343 criou clients.first_source,
-- quotes.source e jobs.source, mas só as plataformas vinham preenchidas. Aqui só entra o que
-- tem prova; o resto fica nulo (melhor vazio que errado).

-- Clientes: conta B2B = e-mail da empresa; marcador do site; lead do Checkatrade nas notas.
update public.clients c
   set first_source = case
         when a.process_type = 'b2b' then 'b2b_email'
         when c.notes ilike '%website lead%' or c.notes ilike '%getfixfy.com%' then 'website'
         when c.notes ilike '%checkatrade%' then 'checkatrade'
       end
  from public.clients c2
  left join public.accounts a on a.id = c2.source_account_id
 where c2.id = c.id
   and c.deleted_at is null
   and c.first_source is null
   and (a.process_type = 'b2b' or c.notes ilike '%website lead%' or c.notes ilike '%getfixfy.com%' or c.notes ilike '%checkatrade%');

-- Quotes: a origem da conta (plataforma/B2B) ou, na Fixfy, a do cliente.
update public.quotes q
   set source = coalesce(
         case a.id
           when '9659bbfb-eb56-4a31-9773-7f5e1335d0b4' then 'housekeep'
           when '38b48520-f116-4263-90e5-8cd5a7d39ecf' then 'checkatrade_express'
           when '3da39c93-4456-4ab1-9bcc-4e87d9564dbd' then 'fantastic'
         end,
         case when a.process_type = 'b2b' then 'b2b_email' end,
         c.first_source)
  from public.quotes q2
  left join public.clients c on c.id = q2.client_id
  left join public.accounts a on a.id = coalesce(q2.source_account_id, c.source_account_id)
 where q2.id = q.id
   and q.deleted_at is null
   and q.source is null;

-- Jobs sem origem: a da quote, senão a do cliente, senão B2B pela conta.
update public.jobs j
   set source = coalesce(q.source, c.first_source, case when a.process_type = 'b2b' then 'b2b_email' end)
  from public.jobs j2
  left join public.quotes q on q.id = j2.quote_id
  left join public.clients c on c.id = j2.client_id
  left join public.accounts a on a.id = coalesce(j2.account_id, c.source_account_id)
 where j2.id = j.id
   and j.deleted_at is null
   and j.source is null
   and coalesce(q.source, c.first_source, case when a.process_type = 'b2b' then 'b2b_email' end) is not null;
