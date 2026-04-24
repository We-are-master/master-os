-- =============================================================================
-- Migration 150: RLS scoping on core master-os tables the portal reads
-- =============================================================================
--
-- Today the portal's server-fetchers in master-portal use the service
-- role client, which bypasses RLS. Tenant isolation depends entirely
-- on remembering to add `.eq("source_account_id", X)` in every query.
-- This migration adds the database-layer defense so a forgotten filter
-- can't leak data.
--
-- Tables covered:
--   - accounts            (portal user: own row only)
--   - clients             (source_account_id match)
--   - quotes              (via client_id → clients.source_account_id)
--   - service_requests    (via client_id → clients.source_account_id)
--   - invoices            (direct source_account_id OR via job)
--   - jobs                (staff | portal | partner-assigned)
--
-- Each policy lets staff see everything via is_internal_staff(), which
-- keeps the master-os dashboard behaviour unchanged. Partners keep
-- their existing mobile-app flow because (a) partner routes use
-- service role and (b) the jobs policy explicitly allows the partner
-- assigned to a job to see it.
--
-- Only SELECT policies here. INSERT/UPDATE/DELETE from portal keep
-- going through service role until week 2 migrates them to anon.
-- =============================================================================

-- =============================================
-- 1. accounts
-- =============================================
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accounts_select_scoped" ON public.accounts;
CREATE POLICY "accounts_select_scoped"
  ON public.accounts FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR id = public.current_portal_account_id()
  );

-- =============================================
-- 2. clients
-- =============================================
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_select_scoped" ON public.clients;
CREATE POLICY "clients_select_scoped"
  ON public.clients FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR source_account_id = public.current_portal_account_id()
  );

-- =============================================
-- 3. quotes
-- =============================================
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quotes_select_scoped" ON public.quotes;
CREATE POLICY "quotes_select_scoped"
  ON public.quotes FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = quotes.client_id
        AND c.source_account_id = public.current_portal_account_id()
    )
  );

-- =============================================
-- 4. service_requests
-- =============================================
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_requests_select_scoped" ON public.service_requests;
CREATE POLICY "service_requests_select_scoped"
  ON public.service_requests FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = service_requests.client_id
        AND c.source_account_id = public.current_portal_account_id()
    )
  );

-- =============================================
-- 5. invoices
-- =============================================
-- Dual ownership path because portal-invoices.ts queries both:
--   (a) invoices.source_account_id = account_id
--   (b) invoices.job_reference where that job belongs to a client in
--       the account (legacy rows where source_account_id wasn't set).
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_select_scoped" ON public.invoices;
CREATE POLICY "invoices_select_scoped"
  ON public.invoices FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR source_account_id = public.current_portal_account_id()
    OR EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.clients c ON c.id = j.client_id
      WHERE j.reference = invoices.job_reference
        AND c.source_account_id = public.current_portal_account_id()
    )
  );

-- =============================================
-- 6. jobs
-- =============================================
-- Three-way scoping:
--   - Staff see all.
--   - Partners see jobs where partner_id matches their own partners.id
--     (linked via partners.auth_user_id = auth.uid()). Preserves the
--     existing mobile-app read path.
--   - Portal users see jobs whose client belongs to their account.
--
-- jobs currently has no RLS policies on origin/main. Enabling RLS
-- here flips the default to deny — every SELECT will be filtered by
-- this policy. Service-role callers (most backend code) bypass.
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jobs_select_scoped" ON public.jobs;
CREATE POLICY "jobs_select_scoped"
  ON public.jobs FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR (
      jobs.partner_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.partners p
        WHERE p.id = jobs.partner_id
          AND p.auth_user_id = auth.uid()
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = jobs.client_id
        AND c.source_account_id = public.current_portal_account_id()
    )
  );
