-- =============================================================================
-- Migration 125: Performance — bundle RPCs + missing indexes
-- =============================================================================
--
-- Replaces N parallel/sequential queries with single round-trip RPCs that
-- return JSONB payloads. Each RPC is SECURITY INVOKER so RLS policies still
-- apply against the calling user.
--
-- All statements are idempotent: CREATE OR REPLACE / CREATE INDEX IF NOT EXISTS.
-- =============================================================================

-- =============================================
-- 1. MISSING INDEXES
-- =============================================
-- Identified during the perf audit. Follow the partial-index pattern from 054.

-- partners: portal-link lookup by auth user
CREATE INDEX IF NOT EXISTS idx_partners_auth_user_id
  ON public.partners (auth_user_id) WHERE auth_user_id IS NOT NULL;

-- partner_documents: compliance aggregates (status per partner)
CREATE INDEX IF NOT EXISTS idx_partner_documents_partner_status
  ON public.partner_documents (partner_id, status);

-- job_payments: simple per-job lookup (composite (job_id, type) already exists in 054)
CREATE INDEX IF NOT EXISTS idx_job_payments_job_id_active
  ON public.job_payments (job_id) WHERE deleted_at IS NULL;

-- quote_line_items: ordered fetch per quote (composite covers both filter + sort)
CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote_sort
  ON public.quote_line_items (quote_id, sort_order);

-- self_bills: partner detail join
CREATE INDEX IF NOT EXISTS idx_self_bills_partner_week
  ON public.self_bills (partner_id, week_start DESC);

-- jobs: invoice / self_bill linkage (already partial-indexed in 054? double-check)
CREATE INDEX IF NOT EXISTS idx_jobs_invoice_id_active
  ON public.jobs (invoice_id) WHERE deleted_at IS NULL AND invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_self_bill_id_active
  ON public.jobs (self_bill_id) WHERE deleted_at IS NULL AND self_bill_id IS NOT NULL;

-- =============================================
-- 2. RPC: get_partners_list_bundle
-- =============================================
-- Returns partners + per-row aggregates (document counts by status, jobs count)
-- in a single call. Replaces ~19 queries fired by /partners page.
--
-- Args:
--   p_status text         — filter by partners.status (or NULL for all)
--   p_trade  text         — filter by partners.trade or trades array (or NULL)
--   p_search text         — case-insensitive ILIKE on company_name/email/contact_name
--   p_limit  int          — page size (default 100)
--   p_offset int          — page offset (default 0)
--
-- Returns: jsonb { rows: [...], total: int }

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
    ORDER BY created_at DESC NULLS LAST
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

-- =============================================
-- 3. RPC: get_job_detail_bundle
-- =============================================
-- Single call: job + client + partner + payments + self_bill + invoice +
-- quote_line_items + reports + recent audit timeline.
-- Replaces 4-6 sequential Promise.all chains in /jobs/[id].

CREATE OR REPLACE FUNCTION public.get_job_detail_bundle(
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
DECLARE
  v_job        jsonb;
  v_client     jsonb;
  v_partner    jsonb;
  v_payments   jsonb;
  v_self_bill  jsonb;
  v_invoice    jsonb;
  v_line_items jsonb;
  v_reports    jsonb;
  v_audit      jsonb;
  v_quote_id   uuid;
  v_client_id  uuid;
  v_partner_id uuid;
  v_self_bill_id uuid;
  v_invoice_id   uuid;
BEGIN
  -- Pull the job row first so we can fan out joins
  SELECT to_jsonb(j),
         j.client_id,
         j.partner_id,
         j.quote_id,
         j.self_bill_id,
         j.invoice_id
    INTO v_job, v_client_id, v_partner_id, v_quote_id, v_self_bill_id, v_invoice_id
  FROM public.jobs j
  WHERE j.id = p_job_id
    AND j.deleted_at IS NULL;

  IF v_job IS NULL THEN
    RETURN jsonb_build_object('error', 'job_not_found');
  END IF;

  -- Client (optional)
  IF v_client_id IS NOT NULL THEN
    SELECT to_jsonb(c) INTO v_client
    FROM public.clients c
    WHERE c.id = v_client_id AND c.deleted_at IS NULL;
  END IF;

  -- Partner (optional)
  IF v_partner_id IS NOT NULL THEN
    SELECT to_jsonb(p) INTO v_partner
    FROM public.partners p
    WHERE p.id = v_partner_id;
  END IF;

  -- Payments (job_payments)
  SELECT coalesce(jsonb_agg(to_jsonb(jp) ORDER BY jp.payment_date DESC NULLS LAST), '[]'::jsonb)
    INTO v_payments
  FROM public.job_payments jp
  WHERE jp.job_id = p_job_id AND jp.deleted_at IS NULL;

  -- Self-bill (optional)
  IF v_self_bill_id IS NOT NULL THEN
    SELECT to_jsonb(sb) INTO v_self_bill
    FROM public.self_bills sb
    WHERE sb.id = v_self_bill_id;
  END IF;

  -- Invoice (optional)
  IF v_invoice_id IS NOT NULL THEN
    SELECT to_jsonb(i) INTO v_invoice
    FROM public.invoices i
    WHERE i.id = v_invoice_id AND i.deleted_at IS NULL;
  END IF;

  -- Quote line items (optional)
  IF v_quote_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(qli) ORDER BY qli.sort_order NULLS LAST), '[]'::jsonb)
      INTO v_line_items
    FROM public.quote_line_items qli
    WHERE qli.quote_id = v_quote_id;
  END IF;

  -- Job reports (per-phase)
  SELECT coalesce(jsonb_agg(to_jsonb(jr) ORDER BY jr.uploaded_at ASC NULLS LAST), '[]'::jsonb)
    INTO v_reports
  FROM public.job_reports jr
  WHERE jr.job_id = p_job_id;

  -- Recent audit timeline (last 50 entries)
  SELECT coalesce(jsonb_agg(to_jsonb(al) ORDER BY al.created_at DESC), '[]'::jsonb)
    INTO v_audit
  FROM (
    SELECT *
    FROM public.audit_logs
    WHERE entity_type = 'job' AND entity_id = p_job_id
    ORDER BY created_at DESC
    LIMIT 50
  ) al;

  RETURN jsonb_build_object(
    'job',         v_job,
    'client',      v_client,
    'partner',     v_partner,
    'payments',    coalesce(v_payments,   '[]'::jsonb),
    'self_bill',   v_self_bill,
    'invoice',     v_invoice,
    'line_items',  coalesce(v_line_items, '[]'::jsonb),
    'reports',     coalesce(v_reports,    '[]'::jsonb),
    'audit',       coalesce(v_audit,      '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_job_detail_bundle TO authenticated;

-- =============================================
-- 4. RPC: get_quotes_list_bundle
-- =============================================
-- Quotes + line item counts + funnel-friendly aggregate fields. Status counts
-- come from the existing get_status_counts() RPC; this one only handles list rows.

CREATE OR REPLACE FUNCTION public.get_quotes_list_bundle(
  p_status text DEFAULT NULL,
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
    SELECT q.*
    FROM public.quotes q
    WHERE q.deleted_at IS NULL
      AND (p_status IS NULL OR q.status = p_status)
      AND (
        p_search IS NULL OR (
          coalesce(q.reference,    '') ILIKE '%' || p_search || '%'
          OR coalesce(q.title,     '') ILIKE '%' || p_search || '%'
          OR coalesce(q.client_name, '') ILIKE '%' || p_search || '%'
          OR coalesce(q.client_email, '') ILIKE '%' || p_search || '%'
        )
      )
  ),
  paged AS (
    SELECT *
    FROM filtered
    ORDER BY created_at DESC NULLS LAST
    LIMIT  p_limit
    OFFSET p_offset
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

  SELECT count(*) INTO v_total
  FROM public.quotes q
  WHERE q.deleted_at IS NULL
    AND (p_status IS NULL OR q.status = p_status)
    AND (
      p_search IS NULL OR (
        coalesce(q.reference,    '') ILIKE '%' || p_search || '%'
        OR coalesce(q.title,     '') ILIKE '%' || p_search || '%'
        OR coalesce(q.client_name, '') ILIKE '%' || p_search || '%'
        OR coalesce(q.client_email, '') ILIKE '%' || p_search || '%'
      )
    );

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_quotes_list_bundle TO authenticated;

-- =============================================
-- 5. RPC: get_requests_list_bundle
-- =============================================
-- Service requests + linked client + linked address (if any).

CREATE OR REPLACE FUNCTION public.get_requests_list_bundle(
  p_status text DEFAULT NULL,
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
    SELECT sr.*
    FROM public.service_requests sr
    WHERE sr.deleted_at IS NULL
      AND (p_status IS NULL OR sr.status = p_status)
      AND (
        p_search IS NULL OR (
          coalesce(sr.reference,     '') ILIKE '%' || p_search || '%'
          OR coalesce(sr.client_name,  '') ILIKE '%' || p_search || '%'
          OR coalesce(sr.client_email, '') ILIKE '%' || p_search || '%'
          OR coalesce(sr.property_address, '') ILIKE '%' || p_search || '%'
          OR coalesce(sr.service_type, '') ILIKE '%' || p_search || '%'
        )
      )
  ),
  paged AS (
    SELECT *
    FROM filtered
    ORDER BY created_at DESC NULLS LAST
    LIMIT  p_limit
    OFFSET p_offset
  )
  SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
    INTO v_rows
  FROM paged p;

  SELECT count(*) INTO v_total
  FROM public.service_requests sr
  WHERE sr.deleted_at IS NULL
    AND (p_status IS NULL OR sr.status = p_status)
    AND (
      p_search IS NULL OR (
        coalesce(sr.reference,     '') ILIKE '%' || p_search || '%'
        OR coalesce(sr.client_name,  '') ILIKE '%' || p_search || '%'
        OR coalesce(sr.client_email, '') ILIKE '%' || p_search || '%'
        OR coalesce(sr.property_address, '') ILIKE '%' || p_search || '%'
        OR coalesce(sr.service_type, '') ILIKE '%' || p_search || '%'
      )
    );

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_requests_list_bundle TO authenticated;

-- =============================================
-- 6. RPC: get_invoices_list_bundle
-- =============================================
-- Invoices + per-row payment totals derived from job_payments.
-- Replaces the chunked .in("job_reference", slice) loop in /finance/invoices.

CREATE OR REPLACE FUNCTION public.get_invoices_list_bundle(
  p_period_start timestamptz DEFAULT NULL,
  p_period_end   timestamptz DEFAULT NULL,
  p_status       text        DEFAULT NULL,
  p_search       text        DEFAULT NULL,
  p_limit        int         DEFAULT 200,
  p_offset       int         DEFAULT 0
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
    SELECT i.*
    FROM public.invoices i
    WHERE i.deleted_at IS NULL
      AND (p_period_start IS NULL OR i.created_at >= p_period_start)
      AND (p_period_end   IS NULL OR i.created_at <  p_period_end)
      AND (p_status IS NULL OR i.status = p_status)
      AND (
        p_search IS NULL OR (
          coalesce(i.reference,    '') ILIKE '%' || p_search || '%'
          OR coalesce(i.client_name, '') ILIKE '%' || p_search || '%'
          OR coalesce(i.job_reference, '') ILIKE '%' || p_search || '%'
        )
      )
  ),
  paged AS (
    SELECT *
    FROM filtered
    ORDER BY created_at DESC NULLS LAST
    LIMIT  p_limit
    OFFSET p_offset
  ),
  -- Sum job_payments tagged "customer_*" against the invoice's job_reference
  payment_agg AS (
    SELECT
      j.invoice_id,
      sum(jp.amount) AS payments_total
    FROM public.job_payments jp
    JOIN public.jobs j ON j.id = jp.job_id
    WHERE j.deleted_at IS NULL
      AND jp.deleted_at IS NULL
      AND j.invoice_id IN (SELECT id FROM paged)
      AND jp.type IN ('customer_deposit', 'customer_final', 'customer_payment')
    GROUP BY j.invoice_id
  )
  SELECT coalesce(jsonb_agg(
           to_jsonb(p)
           || jsonb_build_object('payments_total', coalesce(pa.payments_total, 0))
         ), '[]'::jsonb)
    INTO v_rows
  FROM paged p
  LEFT JOIN payment_agg pa ON pa.invoice_id = p.id;

  SELECT count(*) INTO v_total
  FROM public.invoices i
  WHERE i.deleted_at IS NULL
    AND (p_period_start IS NULL OR i.created_at >= p_period_start)
    AND (p_period_end   IS NULL OR i.created_at <  p_period_end)
    AND (p_status IS NULL OR i.status = p_status)
    AND (
      p_search IS NULL OR (
        coalesce(i.reference,    '') ILIKE '%' || p_search || '%'
        OR coalesce(i.client_name, '') ILIKE '%' || p_search || '%'
        OR coalesce(i.job_reference, '') ILIKE '%' || p_search || '%'
      )
    );

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invoices_list_bundle TO authenticated;

-- =============================================
-- 7. COMMENTS
-- =============================================
COMMENT ON FUNCTION public.get_partners_list_bundle  IS 'Perf bundle: partners list + doc counts + job counts in one call. Phase 2.1.';
COMMENT ON FUNCTION public.get_job_detail_bundle     IS 'Perf bundle: full job detail (client, partner, payments, reports, audit) in one call. Phase 2.2.';
COMMENT ON FUNCTION public.get_quotes_list_bundle    IS 'Perf bundle: quotes list + line item counts in one call. Phase 2.3.';
COMMENT ON FUNCTION public.get_requests_list_bundle  IS 'Perf bundle: service requests list in one call. Phase 2.4.';
COMMENT ON FUNCTION public.get_invoices_list_bundle  IS 'Perf bundle: invoices list + customer payment totals in one call. Phase 2.5.';
