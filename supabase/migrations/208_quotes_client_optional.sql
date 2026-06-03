-- 208_quotes_client_optional.sql
--
-- Quotes can be drafted before a client is known (e.g. created via the
-- external /api/quotes integration, the Zendesk desk webhook, or an internal
-- draft). The API already writes client_id/client_name/client_email = NULL in
-- that case, but the original schema (001_initial_schema.sql) declared
-- client_name and client_email as NOT NULL, so those inserts failed with:
--   null value in column "client_name" of relation "quotes" violates not-null constraint
--
-- Drop the NOT NULL constraint on both columns so a client is optional.

alter table public.quotes alter column client_name  drop not null;
alter table public.quotes alter column client_email drop not null;
