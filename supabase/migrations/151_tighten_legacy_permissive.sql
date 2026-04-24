-- =============================================================================
-- Migration 151: replace legacy USING(true) policies with scoped versions
-- =============================================================================
--
-- Four tables ship with "any authenticated user can do anything"
-- policies that predate the portal being tenant-facing. With portal
-- users now logging in as `authenticated` against the same project,
-- those policies leak cross-account data.
--
-- Tables covered:
--   - quote_line_items  (via quote → client → source_account_id)
--   - job_payments      (via job   → client → source_account_id)
--   - job_reports       (via job   → client → source_account_id)
--   - audit_logs        (per entity_type, join to owning client)
--
-- Staff keep seeing everything via is_internal_staff(); partner and
-- service-role access paths are unchanged (both bypass via service
-- role in backend code).
-- =============================================================================

-- =============================================
-- 1. quote_line_items
-- =============================================
-- Original policy (migration 010) was a single FOR ALL USING (true).
DROP POLICY IF EXISTS "Authenticated users can manage quote line items"
  ON public.quote_line_items;

ALTER TABLE public.quote_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quote_line_items_select_scoped" ON public.quote_line_items;
CREATE POLICY "quote_line_items_select_scoped"
  ON public.quote_line_items FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR EXISTS (
      SELECT 1
      FROM public.quotes q
      JOIN public.clients c ON c.id = q.client_id
      WHERE q.id = quote_line_items.quote_id
        AND c.source_account_id = public.current_portal_account_id()
    )
  );

-- INSERT/UPDATE/DELETE intentionally have no policy for `authenticated`
-- — those operations happen from master-os staff (service role) or
-- from portal via the request/quote approval API routes (service role).
-- If a future migration switches those to anon, add matching policies.

-- =============================================
-- 2. job_payments
-- =============================================
-- Original (migration 012) was four USING(true) policies.
DROP POLICY IF EXISTS "Authenticated users can view job_payments"   ON public.job_payments;
DROP POLICY IF EXISTS "Authenticated users can insert job_payments" ON public.job_payments;
DROP POLICY IF EXISTS "Authenticated users can update job_payments" ON public.job_payments;
DROP POLICY IF EXISTS "Authenticated users can delete job_payments" ON public.job_payments;

ALTER TABLE public.job_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_payments_select_scoped" ON public.job_payments;
CREATE POLICY "job_payments_select_scoped"
  ON public.job_payments FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.clients c ON c.id = j.client_id
      WHERE j.id = job_payments.job_id
        AND c.source_account_id = public.current_portal_account_id()
    )
  );

-- =============================================
-- 3. job_reports
-- =============================================
-- Original (migration 016) was three USING(true) policies.
DROP POLICY IF EXISTS "Authenticated can view job_reports"   ON public.job_reports;
DROP POLICY IF EXISTS "Authenticated can insert job_reports" ON public.job_reports;
DROP POLICY IF EXISTS "Authenticated can update job_reports" ON public.job_reports;

ALTER TABLE public.job_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_reports_select_scoped" ON public.job_reports;
CREATE POLICY "job_reports_select_scoped"
  ON public.job_reports FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.clients c ON c.id = j.client_id
      WHERE j.id = job_reports.job_id
        AND c.source_account_id = public.current_portal_account_id()
    )
  );

-- =============================================
-- 4. audit_logs
-- =============================================
-- Original (migration 005) allowed any authenticated user to SELECT
-- and INSERT audit rows. A portal user could previously read internal
-- operations history for entities they otherwise couldn't see.
--
-- Staff keep seeing all. Portal users only see audit rows for entities
-- they own — the JOIN walks entity_type → owning client.source_account_id.
--
-- INSERT continues to be allowed for authenticated so master-os staff
-- code and RPCs can still write audit entries; the WITH CHECK is
-- intentionally permissive because inserts are always driven by
-- server-side helpers, never raw from a portal client.
DROP POLICY IF EXISTS "Authenticated users can view audit_logs"   ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert audit_logs" ON public.audit_logs;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_select_scoped" ON public.audit_logs;
CREATE POLICY "audit_logs_select_scoped"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR (
      entity_type = 'account'
      AND entity_id::text = public.current_portal_account_id()::text
    )
    OR (
      entity_type = 'job'
      AND EXISTS (
        SELECT 1 FROM public.jobs j
        JOIN public.clients c ON c.id = j.client_id
        WHERE j.id::text = audit_logs.entity_id::text
          AND c.source_account_id = public.current_portal_account_id()
      )
    )
    OR (
      entity_type = 'quote'
      AND EXISTS (
        SELECT 1 FROM public.quotes q
        JOIN public.clients c ON c.id = q.client_id
        WHERE q.id::text = audit_logs.entity_id::text
          AND c.source_account_id = public.current_portal_account_id()
      )
    )
    OR (
      entity_type = 'request'
      AND EXISTS (
        SELECT 1 FROM public.service_requests r
        JOIN public.clients c ON c.id = r.client_id
        WHERE r.id::text = audit_logs.entity_id::text
          AND c.source_account_id = public.current_portal_account_id()
      )
    )
    OR (
      entity_type = 'invoice'
      AND EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.id::text = audit_logs.entity_id::text
          AND (
            i.source_account_id = public.current_portal_account_id()
            OR EXISTS (
              SELECT 1 FROM public.jobs j
              JOIN public.clients c ON c.id = j.client_id
              WHERE j.reference = i.job_reference
                AND c.source_account_id = public.current_portal_account_id()
            )
          )
      )
    )
  );

DROP POLICY IF EXISTS "audit_logs_insert_authenticated" ON public.audit_logs;
CREATE POLICY "audit_logs_insert_authenticated"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (true);

-- NOTE on performance:
-- The EXISTS subqueries on audit_logs are the heaviest part of this
-- migration. Watch the staff dashboard "recent activity" list after
-- deploy — if EXPLAIN ANALYZE shows excessive cost, week 2 can add:
--   CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
-- (Check via `\d audit_logs` whether this already exists — migration 005
-- may already have it.)
