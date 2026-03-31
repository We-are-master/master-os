-- Consolidate dashboard counts into one SQL call and improve common Requests/Quotes access paths.

CREATE OR REPLACE FUNCTION public.get_status_counts(
  p_table_name text,
  p_statuses text[],
  p_status_column text DEFAULT 'status',
  p_date_column text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS TABLE(status text, count bigint, total bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table text;
  v_where text := 'deleted_at IS NULL';
  v_total bigint := 0;
  v_sql text;
BEGIN
  IF p_table_name NOT IN ('quotes', 'service_requests', 'jobs') THEN
    RAISE EXCEPTION 'Unsupported table for get_status_counts: %', p_table_name;
  END IF;

  IF p_status_column IS NULL OR p_status_column !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid status column: %', p_status_column;
  END IF;

  v_table := quote_ident(p_table_name);

  IF p_date_column IS NOT NULL AND p_date_column <> '' THEN
    IF p_date_column !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
      RAISE EXCEPTION 'Invalid date column: %', p_date_column;
    END IF;
    IF p_date_from IS NOT NULL THEN
      v_where := v_where || format(' AND %I >= %L::timestamptz', p_date_column, p_date_from);
    END IF;
    IF p_date_to IS NOT NULL THEN
      v_where := v_where || format(' AND %I <= %L::timestamptz', p_date_column, p_date_to);
    END IF;
  END IF;

  v_sql := format('SELECT count(*) FROM %s WHERE %s', v_table, v_where);
  EXECUTE v_sql INTO v_total;

  v_sql := format(
    'WITH grouped AS (
       SELECT %1$I::text AS status, count(*)::bigint AS c
       FROM %2$s
       WHERE %3$s
       GROUP BY 1
     )
     SELECT s.status, COALESCE(g.c, 0)::bigint AS count, %4$L::bigint AS total
     FROM unnest($1::text[]) AS s(status)
     LEFT JOIN grouped g USING(status)',
    p_status_column,
    v_table,
    v_where,
    v_total
  );

  RETURN QUERY EXECUTE v_sql USING COALESCE(p_statuses, ARRAY[]::text[]);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_status_counts(text, text[], text, text, timestamptz, timestamptz) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_quotes_status_created_active
  ON public.quotes(status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_service_requests_status_created_active
  ON public.service_requests(status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote_sort
  ON public.quote_line_items(quote_id, sort_order);
