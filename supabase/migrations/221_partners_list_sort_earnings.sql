-- Partners directory: sort list bundle by lifetime earnings (highest first).

CREATE OR REPLACE FUNCTION public.get_partners_list_bundle(
  p_status text DEFAULT NULL,
  p_trade  text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit  int  DEFAULT 100,
  p_offset int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
DECLARE
  v_rows  jsonb;
  v_total int;
BEGIN
  WITH filtered AS (
    SELECT p.*
    FROM public.partners p
    WHERE (p_status IS NULL OR p.status = p_status)
      AND (
        p_trade IS NULL
        OR p.trade = p_trade
        OR (p.trades IS NOT NULL AND p_trade = ANY (p.trades))
      )
      AND (
        p_search IS NULL OR (
          p.company_name ILIKE '%' || p_search || '%'
          OR p.email     ILIKE '%' || p_search || '%'
          OR coalesce(p.contact_name, '') ILIKE '%' || p_search || '%'
        )
      )
  ),
  paged AS (
    SELECT *
    FROM filtered
    ORDER BY coalesce(total_earnings, 0) DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT  p_limit
    OFFSET p_offset
  ),
  doc_agg AS (
    SELECT
      pd.partner_id,
      jsonb_object_agg(pd.status, pd.cnt) AS doc_counts
    FROM (
      SELECT partner_id, status, count(*) AS cnt
      FROM public.partner_documents
      WHERE partner_id IN (SELECT id FROM paged)
      GROUP BY partner_id, status
    ) pd
    GROUP BY pd.partner_id
  ),
  job_agg AS (
    SELECT
      j.partner_id,
      count(*) FILTER (WHERE j.status NOT IN ('cancelled', 'completed')) AS active_jobs,
      count(*) FILTER (WHERE j.status = 'completed')                     AS completed_jobs
    FROM public.jobs j
    WHERE j.deleted_at IS NULL
      AND j.partner_id IN (SELECT id FROM paged)
    GROUP BY j.partner_id
  )
  SELECT
    coalesce(jsonb_agg(
      to_jsonb(p)
      || jsonb_build_object(
        'doc_counts',     coalesce(d.doc_counts, '{}'::jsonb),
        'active_jobs',    coalesce(j.active_jobs, 0),
        'completed_jobs', coalesce(j.completed_jobs, 0)
      )
    ), '[]'::jsonb)
  INTO v_rows
  FROM paged p
  LEFT JOIN doc_agg d ON d.partner_id = p.id
  LEFT JOIN job_agg j ON j.partner_id = p.id;

  SELECT count(*) INTO v_total
  FROM public.partners p
  WHERE (p_status IS NULL OR p.status = p_status)
    AND (
      p_trade IS NULL
      OR p.trade = p_trade
      OR (p.trades IS NOT NULL AND p_trade = ANY (p.trades))
    )
    AND (
      p_search IS NULL OR (
        p.company_name ILIKE '%' || p_search || '%'
        OR p.email     ILIKE '%' || p_search || '%'
        OR coalesce(p.contact_name, '') ILIKE '%' || p_search || '%'
      )
    );

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_partners_list_bundle TO authenticated;

COMMENT ON FUNCTION public.get_partners_list_bundle IS 'Perf bundle: partners list + doc counts + job counts; sorted by total_earnings desc.';
