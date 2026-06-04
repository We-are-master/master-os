-- 209_quotes_backfill_service_name.sql
--
-- Backfill: earlier, an integration could send the catalog UUID in
-- `service_type` / `title` instead of the service name, so the raw id leaked
-- into the quote title and the partner emails. The /api/quotes route now
-- resolves catalog_service_id -> service_catalog.name, but rows created before
-- that fix still carry the UUID. This rewrites those rows to the proper name.
--
-- Only rows whose title/service_type is a UUID (or equals the catalog id) are
-- touched; legitimate human-readable titles are left untouched.
--
-- DRY RUN FIRST — see which rows would change:
--   select q.id, q.reference, q.title, q.service_type, sc.name as catalog_name
--   from public.quotes q
--   join public.service_catalog sc on sc.id = q.catalog_service_id
--   where q.catalog_service_id is not null
--     and (
--          q.title = q.catalog_service_id::text
--       or q.title ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
--       or q.service_type = q.catalog_service_id::text
--       or q.service_type ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
--     );

update public.quotes q
set
  title = case
    when q.title = q.catalog_service_id::text
      or q.title ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then sc.name
    else q.title
  end,
  service_type = case
    when q.service_type is null
      or q.service_type = q.catalog_service_id::text
      or q.service_type ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then sc.name
    else q.service_type
  end
from public.service_catalog sc
where q.catalog_service_id = sc.id
  and sc.name is not null
  -- Only rows where the UUID actually leaked into title or service_type.
  and (
       q.title = q.catalog_service_id::text
    or q.title ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or q.service_type = q.catalog_service_id::text
    or q.service_type ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
