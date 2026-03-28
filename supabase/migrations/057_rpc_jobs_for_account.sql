-- RPC to get jobs linked to a corporate account without a huge IN() URL.
-- Joins jobs → clients via client_id, filtering by source_account_id.
-- Also falls back to client_name ILIKE %company_name% for unlinked jobs.

CREATE OR REPLACE FUNCTION get_jobs_for_account(
  p_account_id  uuid,
  p_company_name text DEFAULT ''
)
RETURNS SETOF public.jobs
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT j.*
  FROM public.jobs j
  LEFT JOIN public.clients c ON c.id = j.client_id
  WHERE j.deleted_at IS NULL
    AND (
      c.source_account_id = p_account_id
      OR (p_company_name <> '' AND j.client_name ILIKE '%' || p_company_name || '%')
    )
  ORDER BY j.created_at DESC
  LIMIT 200;
$$;
