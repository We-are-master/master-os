-- Pulse dashboard: Top Accounts by billed job value in a schedule window.
-- Mirrors Accounts drawer linkage: client.source_account_id + client_name ILIKE company_name.

CREATE OR REPLACE FUNCTION public.get_pulse_top_accounts(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL,
  p_limit int DEFAULT 5
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH period_jobs AS (
    SELECT
      j.id,
      j.reference,
      j.client_id,
      j.client_name,
      j.quote_id,
      j.property_id,
      COALESCE(j.client_price, 0) + COALESCE(j.extras_amount, 0) AS billed
    FROM public.jobs j
    WHERE j.deleted_at IS NULL
      AND j.status <> 'cancelled'
      AND (p_from IS NULL OR j.scheduled_start_at >= p_from)
      AND (p_to IS NULL OR j.scheduled_start_at <= p_to)
  ),
  resolved AS (
    SELECT
      pj.*,
      COALESCE(
        c.source_account_id,
        q.source_account_id,
        qc.source_account_id,
        ap.account_id,
        qap.account_id,
        inv.source_account_id,
        name_acc.id
      ) AS account_id
    FROM period_jobs pj
    LEFT JOIN public.clients c
      ON c.id = pj.client_id AND c.deleted_at IS NULL
    LEFT JOIN public.quotes q
      ON q.id = pj.quote_id AND q.deleted_at IS NULL
    LEFT JOIN public.clients qc
      ON qc.id = q.client_id AND qc.deleted_at IS NULL
    LEFT JOIN public.account_properties ap
      ON ap.id = pj.property_id AND ap.deleted_at IS NULL
    LEFT JOIN public.account_properties qap
      ON qap.id = q.property_id AND qap.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT i.source_account_id
      FROM public.invoices i
      WHERE i.deleted_at IS NULL
        AND i.status <> 'cancelled'
        AND i.job_reference IS NOT NULL
        AND trim(i.job_reference) = trim(pj.reference)
      ORDER BY i.created_at DESC
      LIMIT 1
    ) inv ON true
    LEFT JOIN LATERAL (
      SELECT a.id
      FROM public.accounts a
      WHERE a.deleted_at IS NULL
        AND length(trim(coalesce(a.company_name, ''))) >= 3
        AND length(trim(coalesce(pj.client_name, ''))) >= 2
        AND (
          lower(trim(pj.client_name)) = lower(trim(a.company_name))
          OR pj.client_name ILIKE '%' || a.company_name || '%'
          OR a.company_name ILIKE '%' || pj.client_name || '%'
        )
      ORDER BY length(a.company_name) DESC
      LIMIT 1
    ) name_acc ON true
  ),
  agg AS (
    SELECT
      r.account_id,
      count(*)::int AS jobs,
      round(sum(r.billed)::numeric, 2) AS billed
    FROM resolved r
    GROUP BY r.account_id
  ),
  ranked AS (
    SELECT
      a.id AS account_id,
      coalesce(nullif(trim(a.company_name), ''), 'Account') AS company_name,
      a.account_owner_id,
      agg.jobs,
      agg.billed
    FROM agg
    INNER JOIN public.accounts a ON a.id = agg.account_id AND a.deleted_at IS NULL
    WHERE agg.account_id IS NOT NULL
    ORDER BY agg.billed DESC
    LIMIT greatest(p_limit, 1)
  ),
  direct AS (
    SELECT
      count(*)::int AS jobs,
      round(coalesce(sum(billed), 0)::numeric, 2) AS billed
    FROM resolved
    WHERE account_id IS NULL
  )
  SELECT jsonb_build_object(
    'accounts', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'account_id', r.account_id,
            'company_name', r.company_name,
            'account_owner_id', r.account_owner_id,
            'jobs', r.jobs,
            'billed', r.billed
          )
          ORDER BY r.billed DESC
        )
        FROM ranked r
      ),
      '[]'::jsonb
    ),
    'direct', (
      SELECT jsonb_build_object('jobs', d.jobs, 'billed', d.billed)
      FROM direct d
    )
  );
$$;

COMMENT ON FUNCTION public.get_pulse_top_accounts IS
  'Pulse Top Accounts: sum job billed value (client_price + extras) by corporate account for scheduled jobs in range.';

GRANT EXECUTE ON FUNCTION public.get_pulse_top_accounts TO authenticated;
