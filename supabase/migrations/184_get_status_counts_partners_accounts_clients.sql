-- Extend get_status_counts to directory tables invoked from the dashboard
-- (partners-client, accounts/page, clients/page). Calling the RPC with an
-- unsupported table raised PostgreSQL exceptions → PostgREST 400 spam and
-- forced the app into slower SELECT fallbacks after every failing round-trip.

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
  v_where text;
  v_total bigint := 0;
  v_sql text;
BEGIN
  IF p_table_name NOT IN (
    'quotes',
    'service_requests',
    'jobs',
    'partners',
    'accounts',
    'clients'
  ) THEN
    RAISE EXCEPTION 'Unsupported table for get_status_counts: %', p_table_name;
  END IF;

  IF p_status_column IS NULL OR p_status_column !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid status column: %', p_status_column;
  END IF;

  v_table := quote_ident(p_table_name);

  IF p_table_name = 'partners' THEN
    v_where := 'TRUE';
  ELSE
    v_where := 'deleted_at IS NULL';
  END IF;

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
