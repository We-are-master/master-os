-- 358 · CRM de Leads e Quotes: board em tempo real
--
-- A aba Leads escuta mudanças em leads e quotes (postgres_changes). Sem as
-- tabelas na publicação do Realtime o board só atualiza na checagem de 20 s.
-- Só acrescenta; pode rodar mais de uma vez. A RLS das tabelas continua
-- valendo para quem recebe o evento.

do $$ begin
  alter publication supabase_realtime add table public.leads;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.quotes;
exception when duplicate_object then null; end $$;
