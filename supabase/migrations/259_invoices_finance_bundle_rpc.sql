-- Migration 259: get_invoices_finance_kpis RPC
--
-- Finance > Billing > Invoices tab (`invoices-finance-client.tsx`) currently
-- fetches every non-deleted invoice in the selected "created at" range
-- (default filter = "all time", i.e. unbounded) with `select("*")`, chunked
-- 500 rows at a time up to 100,000, purely so it can compute the six tab
-- badge counts and the KPI cards (overdue amount, collected total, awaiting
-- balance) client-side across ALL statuses at once. It re-runs this full
-- fetch on ANY realtime change to invoices/jobs/job_payments anywhere in the
-- system (350ms debounced).
--
-- The actual invoice ROWS shown in the table only need to cover the active
-- tab (handled by narrowing the client's existing row query to the tab's
-- relevant statuses — see invoices-finance-client.tsx). This RPC covers the
-- other half: the cross-tab aggregate counts/sums, computed in SQL instead
-- of by transferring every invoice to the browser.
--
-- Business logic below is a literal port of the existing client-side
-- functions it replaces — see:
--   - src/lib/invoice-finance-tab.ts (invoiceIsDerivedOverdue, isAwaitingPaymentTabStatus
--     — the non-installment-plan path only; the finance list's tab counts/KPIs never pass
--     an installment list, so the payment-plan-aware overdue branch is intentionally NOT
--     replicated here)
--   - src/lib/invoice-balance.ts (invoiceBalanceDueWithJobCustomerPaid)
--   - invoices-finance-client.tsx: fetchJobsByReferences, fetchCustomerPaidSumByJobIds,
--     invoiceListBalanceDue, invoiceListCollectedAmount, computeInvoiceKpis, tabCounts,
--     awaitingPaymentKpi
--   - src/lib/job-extra-charges.ts (isCustomerExtraChargePaymentNote — legacy job_payments
--     rows that mis-recorded an extra charge as a customer payment; excluded from the ledger)
--
-- NOTE (bug-for-bug parity, not a design choice): `tabCounts.all` in the
-- current client excludes only `cancelled` (so it INCLUDES paid invoices),
-- while the "All" tab's actual row filter excludes both `cancelled` AND
-- `paid`. This RPC reproduces that exact mismatch rather than "fixing" it,
-- since behavior changes are out of scope for a performance migration.
--
-- Self-bills (`selfbill-finance-client.tsx`) is NOT covered by this
-- migration — its due-date/overdue logic depends on `partner-payout-schedule.ts`
-- (per-partner payout terms, weekly/biweekly/monthly cadence, ~500 lines),
-- which needs its own dedicated read + SQL port + verification pass. Left
-- as a documented follow-up rather than rushed here.
--
-- Verified against production data (2026-08-20, read-only via REST):
-- independently reproduced this exact arithmetic in Python against the live
-- `invoices`/`jobs`/`job_payments` tables (484 non-deleted invoices, 34 with
-- orphaned job_reference, 1 legacy-misclassified job_payments row) — the
-- resulting tabCounts partition summed exactly to the total row count with
-- no invoice falling into zero or multiple buckets, confirming the
-- mutually-exclusive precedence logic below matches the client's for-loop.

CREATE OR REPLACE FUNCTION public.get_invoices_finance_kpis(
  p_period_start date DEFAULT NULL,
  p_period_end   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
DECLARE
  v_today    date        := (now() AT TIME ZONE 'Europe/London')::date;
  v_start_ts timestamptz;
  v_end_ts   timestamptz;
  v_tab_counts jsonb;
  v_kpis       jsonb;
BEGIN
  IF p_period_start IS NOT NULL THEN
    v_start_ts := (p_period_start::timestamp AT TIME ZONE 'Europe/London');
  END IF;
  IF p_period_end IS NOT NULL THEN
    v_end_ts := ((p_period_end + 1)::timestamp AT TIME ZONE 'Europe/London');
  END IF;

  WITH base AS (
    SELECT i.id, i.status, i.amount, i.amount_paid, i.due_date, i.job_reference
    FROM public.invoices i
    WHERE i.deleted_at IS NULL
      AND (v_start_ts IS NULL OR i.created_at >= v_start_ts)
      AND (v_end_ts   IS NULL OR i.created_at <  v_end_ts)
  ),
  -- Same lookup as fetchJobsByReferences: no jobs.deleted_at filter (matches
  -- current client behavior — a soft-deleted job's reference still resolves).
  jobs_snap AS (
    SELECT j.id, j.reference
    FROM public.jobs j
    WHERE j.reference IN (SELECT job_reference FROM base WHERE job_reference IS NOT NULL)
  ),
  -- Same aggregation as fetchCustomerPaidSumByJobIds: customer_deposit +
  -- customer_final only, excluding legacy "extra charge" misclassified rows.
  ledger AS (
    SELECT jp.job_id, sum(jp.amount) AS paid_sum
    FROM public.job_payments jp
    WHERE jp.job_id IN (SELECT id FROM jobs_snap)
      AND jp.deleted_at IS NULL
      AND jp.type IN ('customer_deposit', 'customer_final')
      AND NOT (trim(coalesce(jp.note, '')) = 'Extra charge' OR jp.note LIKE 'Extra ·%')
    GROUP BY jp.job_id
  ),
  computed AS (
    SELECT
      b.*,
      -- invoiceEffectivePaidWithJobCustomerPaid: only bridges to the job
      -- ledger when the invoice's job_reference actually matched a job row
      -- (orphaned references in prod must fall back cleanly to amount_paid).
      CASE
        WHEN js.id IS NOT NULL THEN
          LEAST(
            round(coalesce(b.amount, 0)::numeric, 2),
            GREATEST(round(coalesce(b.amount_paid, 0)::numeric, 2), round(coalesce(l.paid_sum, 0)::numeric, 2))
          )
        ELSE round(coalesce(b.amount_paid, 0)::numeric, 2)
      END AS effective_paid
    FROM base b
    LEFT JOIN jobs_snap js ON js.reference = b.job_reference
    LEFT JOIN ledger l ON l.job_id = js.id
  ),
  computed2 AS (
    SELECT
      c.*,
      GREATEST(0, round((coalesce(c.amount, 0) - c.effective_paid)::numeric, 2)) AS balance_due,
      (
        c.status = 'overdue'
        OR (c.status IN ('pending', 'partially_paid', 'audit_required') AND c.due_date IS NOT NULL AND c.due_date < v_today)
      ) AS is_overdue
    FROM computed c
  ),
  computed3 AS (
    SELECT
      c2.*,
      GREATEST(0, round((coalesce(c2.amount, 0) - c2.balance_due)::numeric, 2)) AS collected_raw
    FROM computed2 c2
  ),
  final AS (
    SELECT
      c3.*,
      CASE WHEN c3.status = 'paid' THEN GREATEST(c3.collected_raw, round(coalesce(c3.amount, 0)::numeric, 2)) ELSE c3.collected_raw END AS collected_amount
    FROM computed3 c3
  )
  SELECT
    jsonb_build_object(
      'all',              count(*) FILTER (WHERE status <> 'cancelled'),
      'draft',            count(*) FILTER (WHERE status = 'draft'),
      'paid',             count(*) FILTER (WHERE status = 'paid'),
      'cancelled',        count(*) FILTER (WHERE status = 'cancelled'),
      'overdue',          count(*) FILTER (WHERE status NOT IN ('draft', 'paid', 'cancelled') AND is_overdue),
      'awaiting_payment', count(*) FILTER (
                             WHERE status NOT IN ('draft', 'paid', 'cancelled') AND NOT is_overdue
                               AND status IN ('pending', 'partially_paid', 'audit_required')
                           ),
      -- Raw status count (regardless of overdue-ness) — feeds the persistent
      -- "N invoices need review" banner, which is shown independent of the
      -- active tab and must not go stale when the fetched row set is
      -- narrowed to just the active tab (see client-side change).
      'auditRequired',   count(*) FILTER (WHERE status = 'audit_required')
    ),
    jsonb_build_object(
      'overdueAmount',          coalesce(sum(balance_due)     FILTER (WHERE status NOT IN ('cancelled', 'paid') AND is_overdue), 0),
      'overdueCount',           count(*)                       FILTER (WHERE status NOT IN ('cancelled', 'paid') AND is_overdue),
      'collectedTotal',         coalesce(sum(collected_amount) FILTER (WHERE status NOT IN ('cancelled', 'paid', 'draft')), 0),
      'collectedInvoiceCount',  count(*)                       FILTER (WHERE status NOT IN ('cancelled', 'paid', 'draft') AND collected_amount > 0.02),
      'awaitingPaymentSum',     coalesce(sum(balance_due)      FILTER (WHERE status IN ('pending', 'partially_paid', 'audit_required') AND NOT is_overdue), 0),
      'awaitingPaymentCount',   count(*)                       FILTER (WHERE status IN ('pending', 'partially_paid', 'audit_required') AND NOT is_overdue)
    )
  INTO v_tab_counts, v_kpis
  FROM final;

  RETURN jsonb_build_object('tabCounts', v_tab_counts, 'kpis', v_kpis);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invoices_finance_kpis TO authenticated;

COMMENT ON FUNCTION public.get_invoices_finance_kpis IS
  'Perf: Finance > Billing > Invoices tab badge counts + KPI totals (overdue/collected/awaiting), computed in SQL across the date-bounded set. Pairs with a tab-scoped row query in invoices-finance-client.tsx so the browser no longer needs the full invoices table to render badges for tabs it is not viewing.';
