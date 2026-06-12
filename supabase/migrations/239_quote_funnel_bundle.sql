-- Virtual funnel tabs (New / Ready to send) + dashboard metrics in fast RPCs.
-- SQL mirrors isQuoteReadyToSend / isQuoteListNew in src/lib/quote-list-buckets.ts.

CREATE OR REPLACE FUNCTION public.quote_is_ready_to_send_row(
  p_status text,
  p_draft_route_completed boolean,
  p_quote_type text,
  p_customer_pdf_sent_at timestamptz,
  p_total_value numeric
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_status = 'draft'
    AND p_draft_route_completed IS TRUE
    AND coalesce(p_quote_type, 'internal') <> 'partner'
    AND p_customer_pdf_sent_at IS NULL
    AND coalesce(p_total_value, 0) > 0;
$$;

COMMENT ON FUNCTION public.quote_is_ready_to_send_row IS
  'Ready to send funnel tab: manual draft built, PDF not sent, positive value.';

-- Paginated list for virtual funnel tabs (new | ready_to_send).
CREATE OR REPLACE FUNCTION public.get_quote_funnel_bundle(
  p_tab text,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
DECLARE
  v_rows jsonb;
  v_total int;
  v_search text;
BEGIN
  IF p_tab NOT IN ('new', 'ready_to_send') THEN
    RAISE EXCEPTION 'Unsupported funnel tab: %', p_tab;
  END IF;

  v_search := nullif(trim(p_search), '');

  WITH filtered AS (
    SELECT q.*
    FROM public.quotes q
    WHERE q.deleted_at IS NULL
      AND q.status = 'draft'
      AND (
        (p_tab = 'ready_to_send' AND public.quote_is_ready_to_send_row(
          q.status, q.draft_route_completed, q.quote_type, q.customer_pdf_sent_at, q.total_value
        ))
        OR (p_tab = 'new' AND NOT public.quote_is_ready_to_send_row(
          q.status, q.draft_route_completed, q.quote_type, q.customer_pdf_sent_at, q.total_value
        ))
      )
      AND (
        v_search IS NULL OR (
          coalesce(q.reference, '') ILIKE '%' || v_search || '%'
          OR coalesce(q.title, '') ILIKE '%' || v_search || '%'
          OR coalesce(q.client_name, '') ILIKE '%' || v_search || '%'
          OR coalesce(q.client_email, '') ILIKE '%' || v_search || '%'
        )
      )
  ),
  paged AS (
    SELECT *
    FROM filtered
    ORDER BY created_at DESC NULLS LAST
    LIMIT greatest(p_limit, 0)
    OFFSET greatest(p_offset, 0)
  ),
  line_counts AS (
    SELECT quote_id, count(*) AS line_items_count, sum(total) AS line_items_total
    FROM public.quote_line_items
    WHERE quote_id IN (SELECT id FROM paged)
    GROUP BY quote_id
  )
  SELECT coalesce(jsonb_agg(
           to_jsonb(p)
           || jsonb_build_object(
             'line_items_count', coalesce(lc.line_items_count, 0),
             'line_items_total', coalesce(lc.line_items_total, 0)
           )
         ), '[]'::jsonb)
    INTO v_rows
  FROM paged p
  LEFT JOIN line_counts lc ON lc.quote_id = p.id;

  SELECT count(*)::int INTO v_total
  FROM public.quotes q
  WHERE q.deleted_at IS NULL
    AND q.status = 'draft'
    AND (
      (p_tab = 'ready_to_send' AND public.quote_is_ready_to_send_row(
        q.status, q.draft_route_completed, q.quote_type, q.customer_pdf_sent_at, q.total_value
      ))
      OR (p_tab = 'new' AND NOT public.quote_is_ready_to_send_row(
        q.status, q.draft_route_completed, q.quote_type, q.customer_pdf_sent_at, q.total_value
      ))
    )
    AND (
      v_search IS NULL OR (
        coalesce(q.reference, '') ILIKE '%' || v_search || '%'
        OR coalesce(q.title, '') ILIKE '%' || v_search || '%'
        OR coalesce(q.client_name, '') ILIKE '%' || v_search || '%'
        OR coalesce(q.client_email, '') ILIKE '%' || v_search || '%'
      )
    );

  RETURN jsonb_build_object('rows', v_rows, 'total', coalesce(v_total, 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_quote_funnel_bundle(text, text, int, int) TO authenticated;

-- KPI cards + tab badges in one round-trip.
CREATE OR REPLACE FUNCTION public.get_quote_metrics_bundle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
DECLARE
  v_status_counts jsonb;
  v_funnel_new int;
  v_funnel_rts int;
  v_total_sent numeric;
  v_awaiting_customer numeric;
  v_converted int;
  v_total int;
  v_conversion_pct numeric;
BEGIN
  SELECT coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
    INTO v_status_counts
  FROM (
    SELECT q.status, count(*)::int AS cnt
    FROM public.quotes q
    WHERE q.deleted_at IS NULL
    GROUP BY q.status
  ) s;

  SELECT
    count(*) FILTER (
      WHERE q.status = 'draft'
        AND NOT public.quote_is_ready_to_send_row(
          q.status, q.draft_route_completed, q.quote_type, q.customer_pdf_sent_at, q.total_value
        )
    )::int,
    count(*) FILTER (
      WHERE public.quote_is_ready_to_send_row(
        q.status, q.draft_route_completed, q.quote_type, q.customer_pdf_sent_at, q.total_value
      )
    )::int
    INTO v_funnel_new, v_funnel_rts
  FROM public.quotes q
  WHERE q.deleted_at IS NULL;

  SELECT
    coalesce(sum(q.total_value) FILTER (
      WHERE q.status IN ('awaiting_customer', 'awaiting_payment')
    ), 0),
    coalesce(sum(q.total_value) FILTER (WHERE q.status = 'awaiting_customer'), 0),
    count(*) FILTER (WHERE q.status = 'converted_to_job')::int,
    count(*)::int
    INTO v_total_sent, v_awaiting_customer, v_converted, v_total
  FROM public.quotes q
  WHERE q.deleted_at IS NULL;

  IF v_total > 0 THEN
    v_conversion_pct := round((v_converted::numeric / v_total::numeric) * 1000) / 10;
  ELSE
    v_conversion_pct := 0;
  END IF;

  RETURN jsonb_build_object(
    'status_counts', v_status_counts,
    'funnel_counts', jsonb_build_object(
      'draft', coalesce(v_funnel_new, 0),
      'ready_to_send', coalesce(v_funnel_rts, 0)
    ),
    'total_sent_to_customer_value', coalesce(v_total_sent, 0),
    'awaiting_customer_value', coalesce(v_awaiting_customer, 0),
    'converted_count', coalesce(v_converted, 0),
    'total_count', coalesce(v_total, 0),
    'conversion_pct', coalesce(v_conversion_pct, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_quote_metrics_bundle() TO authenticated;

COMMENT ON FUNCTION public.get_quote_funnel_bundle IS
  'Paginated virtual funnel tabs (new | ready_to_send) with line item counts.';

COMMENT ON FUNCTION public.get_quote_metrics_bundle IS
  'Quotes dashboard KPIs, status tab badges, and New/Ready-to-send funnel counts.';
