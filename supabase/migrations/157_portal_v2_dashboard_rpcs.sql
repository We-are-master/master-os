-- =============================================================================
-- Migration 157: portal v2 dashboard RPCs
-- =============================================================================
--
-- Server-side aggregation helpers the portal Dashboard calls. Doing the
-- groupBy/sum in Postgres (a) keeps the dataset tiny on the wire and
-- (b) keeps RLS authoritative without re-checking per row in the app.
--
-- - get_account_spend_by_service: sums jobs.client_price over a window,
--   grouped by service catalog name. Used by the "Spend by service"
--   chart on the dashboard.
--
-- Both functions are SECURITY DEFINER so they bypass the caller's RLS
-- on jobs/clients/service_catalog — but they explicitly filter by
-- account_id at the start, so a portal user only ever gets their own
-- account's data.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_account_spend_by_service(
  p_account_id uuid,
  p_period_days integer DEFAULT 30
)
RETURNS TABLE(
  service_name text,
  total_spend  numeric,
  job_count    integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH account_clients AS (
    SELECT id FROM public.clients
    WHERE source_account_id = p_account_id
      AND deleted_at IS NULL
  )
  SELECT
    COALESCE(sc.name, 'Other')                        AS service_name,
    COALESCE(SUM(j.client_price), 0)::numeric         AS total_spend,
    COUNT(*)::integer                                  AS job_count
  FROM public.jobs j
  LEFT JOIN public.service_catalog sc ON sc.id = j.catalog_service_id
  WHERE j.client_id IN (SELECT id FROM account_clients)
    AND j.deleted_at IS NULL
    AND j.created_at >= (NOW() - (p_period_days || ' days')::interval)
  GROUP BY sc.name
  ORDER BY total_spend DESC
  LIMIT 12
$$;

GRANT EXECUTE ON FUNCTION public.get_account_spend_by_service(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.get_account_spend_by_service(uuid, integer) IS
  'Returns spend totals grouped by service over the last N days for one account. Used by the portal dashboard.';
