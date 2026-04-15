-- =============================================================================
-- Migration 142: Portal account-scoped RLS (PR 1 — security hardening)
-- =============================================================================
--
-- BEFORE: tickets, jobs, quotes, invoices, service_requests, job_payments all
-- had `USING (true)` for authenticated — app-layer scoping in `requirePortalUser()`
-- was the only isolation. A leaked token or buggy endpoint could leak
-- cross-tenant data.
--
-- AFTER: each sensitive table has TWO select policies:
--   - Internal staff (profiles.role IN admin/manager/operator): full access
--   - Portal users (account_portal_users.id = auth.uid()): scoped to their
--     account via the clients.source_account_id chain or tickets.account_id
--
-- INSERT / UPDATE / DELETE policies are also tightened so a portal user
-- cannot write into another account's data even if they craft an API call.
--
-- DESIGN NOTES
-- - `SECURITY DEFINER` helpers avoid RLS recursion when resolving the
--   caller's role / portal account.
-- - `STABLE` means PostgREST can cache the helper result for the duration of
--   a single query — no per-row re-execution cost.
-- - We keep existing "Authenticated" policies named the same whenever
--   possible so other migrations that DROP/CREATE by name stay compatible;
--   policies we replace are dropped explicitly.
-- =============================================================================

-- =============================================
-- 1. Helper functions
-- =============================================

-- Returns the caller's portal account_id if they are an active portal user,
-- otherwise NULL. Fast (single-row PK lookup).
CREATE OR REPLACE FUNCTION public.current_portal_account_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_id
  FROM public.account_portal_users
  WHERE id = auth.uid() AND is_active = true
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_portal_account_id() IS
  'Resolve the portal account_id for the calling user, or NULL if they are not an active portal user. Used by RLS policies to scope data to one account.';

GRANT EXECUTE ON FUNCTION public.current_portal_account_id() TO authenticated;

-- Returns TRUE when the caller is internal staff (has a profiles row with a
-- valid role). Used as the "bypass" branch in RLS policies so the staff
-- dashboard keeps seeing everything.
CREATE OR REPLACE FUNCTION public.is_internal_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'manager', 'operator')
      AND coalesce(is_active, true) = true
  );
$$;

COMMENT ON FUNCTION public.is_internal_staff() IS
  'TRUE when auth.uid() matches an active internal-staff profile. Used by RLS policies to preserve full dashboard access while scoping portal users.';

GRANT EXECUTE ON FUNCTION public.is_internal_staff() TO authenticated;

-- =============================================
-- 2. Clients — portal users only see clients belonging to their account
-- =============================================
DROP POLICY IF EXISTS "clients_select_all"              ON public.clients;
DROP POLICY IF EXISTS "Authenticated users can view clients" ON public.clients;
DROP POLICY IF EXISTS "clients_select_scoped"           ON public.clients;

CREATE POLICY "clients_select_scoped"
  ON public.clients FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR source_account_id = public.current_portal_account_id()
  );

-- Portal users cannot create/update/delete clients; staff can.
DROP POLICY IF EXISTS "clients_insert_staff"            ON public.clients;
DROP POLICY IF EXISTS "Authenticated users can insert clients" ON public.clients;
CREATE POLICY "clients_insert_staff"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (public.is_internal_staff());

DROP POLICY IF EXISTS "clients_update_staff"            ON public.clients;
DROP POLICY IF EXISTS "Authenticated users can update clients" ON public.clients;
CREATE POLICY "clients_update_staff"
  ON public.clients FOR UPDATE TO authenticated
  USING (public.is_internal_staff()) WITH CHECK (public.is_internal_staff());

DROP POLICY IF EXISTS "clients_delete_staff"            ON public.clients;
DROP POLICY IF EXISTS "Authenticated users can delete clients" ON public.clients;
CREATE POLICY "clients_delete_staff"
  ON public.clients FOR DELETE TO authenticated
  USING (public.is_internal_staff());

-- =============================================
-- 3. Service requests — scoped by client.source_account_id
-- =============================================
DROP POLICY IF EXISTS "service_requests_select_all"     ON public.service_requests;
DROP POLICY IF EXISTS "Authenticated users can view requests"   ON public.service_requests;
DROP POLICY IF EXISTS "Authenticated users can view service_requests" ON public.service_requests;
DROP POLICY IF EXISTS "service_requests_select_scoped"  ON public.service_requests;

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

-- Portal users can INSERT a service request for their own account; UPDATE/
-- DELETE stay staff-only.
DROP POLICY IF EXISTS "service_requests_insert_scoped"  ON public.service_requests;
DROP POLICY IF EXISTS "Authenticated users can insert requests"  ON public.service_requests;
DROP POLICY IF EXISTS "Authenticated users can insert service_requests" ON public.service_requests;
CREATE POLICY "service_requests_insert_scoped"
  ON public.service_requests FOR INSERT TO authenticated
  WITH CHECK (
    public.is_internal_staff()
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = service_requests.client_id
        AND c.source_account_id = public.current_portal_account_id()
    )
  );

DROP POLICY IF EXISTS "service_requests_update_staff"   ON public.service_requests;
DROP POLICY IF EXISTS "Authenticated users can update requests"  ON public.service_requests;
DROP POLICY IF EXISTS "Authenticated users can update service_requests" ON public.service_requests;
CREATE POLICY "service_requests_update_staff"
  ON public.service_requests FOR UPDATE TO authenticated
  USING (public.is_internal_staff()) WITH CHECK (public.is_internal_staff());

DROP POLICY IF EXISTS "service_requests_delete_staff"   ON public.service_requests;
DROP POLICY IF EXISTS "Authenticated users can delete requests"  ON public.service_requests;
DROP POLICY IF EXISTS "Authenticated users can delete service_requests" ON public.service_requests;
CREATE POLICY "service_requests_delete_staff"
  ON public.service_requests FOR DELETE TO authenticated
  USING (public.is_internal_staff());

-- =============================================
-- 4. Quotes — scoped by client.source_account_id
-- =============================================
DROP POLICY IF EXISTS "quotes_select_all"               ON public.quotes;
DROP POLICY IF EXISTS "Authenticated users can view quotes" ON public.quotes;
DROP POLICY IF EXISTS "quotes_select_scoped"            ON public.quotes;

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

-- Portal users respond to quotes (accept/reject) via a dedicated API route
-- that uses the service role — they do NOT need raw update access.
DROP POLICY IF EXISTS "quotes_insert_staff"             ON public.quotes;
DROP POLICY IF EXISTS "Authenticated users can insert quotes" ON public.quotes;
CREATE POLICY "quotes_insert_staff"
  ON public.quotes FOR INSERT TO authenticated
  WITH CHECK (public.is_internal_staff());

DROP POLICY IF EXISTS "quotes_update_staff"             ON public.quotes;
DROP POLICY IF EXISTS "Authenticated users can update quotes" ON public.quotes;
CREATE POLICY "quotes_update_staff"
  ON public.quotes FOR UPDATE TO authenticated
  USING (public.is_internal_staff()) WITH CHECK (public.is_internal_staff());

DROP POLICY IF EXISTS "quotes_delete_staff"             ON public.quotes;
DROP POLICY IF EXISTS "Authenticated users can delete quotes" ON public.quotes;
CREATE POLICY "quotes_delete_staff"
  ON public.quotes FOR DELETE TO authenticated
  USING (public.is_internal_staff());

-- quote_line_items follows the parent quote
DROP POLICY IF EXISTS "quote_line_items_select_all"     ON public.quote_line_items;
DROP POLICY IF EXISTS "quote_line_items_select_scoped"  ON public.quote_line_items;
CREATE POLICY "quote_line_items_select_scoped"
  ON public.quote_line_items FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR EXISTS (
      SELECT 1 FROM public.quotes q
      JOIN public.clients c ON c.id = q.client_id
      WHERE q.id = quote_line_items.quote_id
        AND c.source_account_id = public.current_portal_account_id()
    )
  );

-- =============================================
-- 5. Jobs — scoped by client.source_account_id
-- =============================================
DROP POLICY IF EXISTS "jobs_select_all"                 ON public.jobs;
DROP POLICY IF EXISTS "Authenticated users can view jobs" ON public.jobs;
DROP POLICY IF EXISTS "jobs_select_scoped"              ON public.jobs;

CREATE POLICY "jobs_select_scoped"
  ON public.jobs FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    -- External partners still need to see their own jobs — preserved via
    -- a separate legacy policy (migration 081) which targets partners.
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = jobs.client_id
        AND c.source_account_id = public.current_portal_account_id()
    )
  );

DROP POLICY IF EXISTS "jobs_insert_staff"               ON public.jobs;
DROP POLICY IF EXISTS "Authenticated users can insert jobs" ON public.jobs;
CREATE POLICY "jobs_insert_staff"
  ON public.jobs FOR INSERT TO authenticated
  WITH CHECK (public.is_internal_staff());

-- Portal users never directly update jobs — they do via ticket messages.
-- Staff still have update rights. Partners retain their own update path
-- via earlier policies (pre-migration).
DROP POLICY IF EXISTS "jobs_update_staff_or_partner"    ON public.jobs;
DROP POLICY IF EXISTS "Authenticated users can update jobs" ON public.jobs;
CREATE POLICY "jobs_update_staff_or_partner"
  ON public.jobs FOR UPDATE TO authenticated
  USING (
    public.is_internal_staff()
    -- Partners can still update their own assigned jobs (mobile app flows).
    OR (jobs.partner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.partners p
      WHERE p.id = jobs.partner_id AND p.auth_user_id = auth.uid()
    ))
  )
  WITH CHECK (
    public.is_internal_staff()
    OR (jobs.partner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.partners p
      WHERE p.id = jobs.partner_id AND p.auth_user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "jobs_delete_staff"               ON public.jobs;
DROP POLICY IF EXISTS "Authenticated users can delete jobs" ON public.jobs;
CREATE POLICY "jobs_delete_staff"
  ON public.jobs FOR DELETE TO authenticated
  USING (public.is_internal_staff());

-- =============================================
-- 6. Invoices + job_payments — scoped through source_account_id / job→client
-- =============================================
DROP POLICY IF EXISTS "invoices_select_all"             ON public.invoices;
DROP POLICY IF EXISTS "Authenticated users can view invoices" ON public.invoices;
DROP POLICY IF EXISTS "invoices_select_scoped"          ON public.invoices;

CREATE POLICY "invoices_select_scoped"
  ON public.invoices FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR invoices.source_account_id = public.current_portal_account_id()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.clients c ON c.id = j.client_id
      WHERE j.reference = invoices.job_reference
        AND c.source_account_id = public.current_portal_account_id()
    )
  );

DROP POLICY IF EXISTS "invoices_insert_staff"           ON public.invoices;
DROP POLICY IF EXISTS "Authenticated users can insert invoices" ON public.invoices;
CREATE POLICY "invoices_insert_staff"
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (public.is_internal_staff());

DROP POLICY IF EXISTS "invoices_update_staff"           ON public.invoices;
DROP POLICY IF EXISTS "Authenticated users can update invoices" ON public.invoices;
CREATE POLICY "invoices_update_staff"
  ON public.invoices FOR UPDATE TO authenticated
  USING (public.is_internal_staff()) WITH CHECK (public.is_internal_staff());

DROP POLICY IF EXISTS "invoices_delete_staff"           ON public.invoices;
DROP POLICY IF EXISTS "Authenticated users can delete invoices" ON public.invoices;
CREATE POLICY "invoices_delete_staff"
  ON public.invoices FOR DELETE TO authenticated
  USING (public.is_internal_staff());

-- job_payments: portal users see only payments for their jobs; crucially
-- the row's `note` field is never rendered in the portal UI (internal only).
DROP POLICY IF EXISTS "job_payments_select_all"         ON public.job_payments;
DROP POLICY IF EXISTS "Authenticated users can view job_payments" ON public.job_payments;
DROP POLICY IF EXISTS "job_payments_select_scoped"      ON public.job_payments;

CREATE POLICY "job_payments_select_scoped"
  ON public.job_payments FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR (
      -- Portal users see only customer-side payment types
      job_payments.type IN ('customer_deposit', 'customer_final')
      AND EXISTS (
        SELECT 1 FROM public.jobs j
        JOIN public.clients c ON c.id = j.client_id
        WHERE j.id = job_payments.job_id
          AND c.source_account_id = public.current_portal_account_id()
      )
    )
  );

DROP POLICY IF EXISTS "job_payments_write_staff"        ON public.job_payments;
DROP POLICY IF EXISTS "Authenticated users can insert job_payments" ON public.job_payments;
DROP POLICY IF EXISTS "Authenticated users can update job_payments" ON public.job_payments;
DROP POLICY IF EXISTS "Authenticated users can delete job_payments" ON public.job_payments;
CREATE POLICY "job_payments_insert_staff"
  ON public.job_payments FOR INSERT TO authenticated
  WITH CHECK (public.is_internal_staff());
CREATE POLICY "job_payments_update_staff"
  ON public.job_payments FOR UPDATE TO authenticated
  USING (public.is_internal_staff()) WITH CHECK (public.is_internal_staff());
CREATE POLICY "job_payments_delete_staff"
  ON public.job_payments FOR DELETE TO authenticated
  USING (public.is_internal_staff());

-- =============================================
-- 7. Tickets + ticket_messages — scoped by tickets.account_id
-- =============================================
DROP POLICY IF EXISTS "Authenticated can read all tickets"   ON public.tickets;
DROP POLICY IF EXISTS "Authenticated can insert tickets"     ON public.tickets;
DROP POLICY IF EXISTS "Authenticated can update tickets"     ON public.tickets;
DROP POLICY IF EXISTS "tickets_select_scoped"                ON public.tickets;

CREATE POLICY "tickets_select_scoped"
  ON public.tickets FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR tickets.account_id = public.current_portal_account_id()
  );

CREATE POLICY "tickets_insert_scoped"
  ON public.tickets FOR INSERT TO authenticated
  WITH CHECK (
    public.is_internal_staff()
    OR tickets.account_id = public.current_portal_account_id()
  );

CREATE POLICY "tickets_update_scoped"
  ON public.tickets FOR UPDATE TO authenticated
  USING (
    public.is_internal_staff()
    OR tickets.account_id = public.current_portal_account_id()
  )
  WITH CHECK (
    public.is_internal_staff()
    OR tickets.account_id = public.current_portal_account_id()
  );

DROP POLICY IF EXISTS "Authenticated can read all ticket messages" ON public.ticket_messages;
DROP POLICY IF EXISTS "Authenticated can insert ticket messages"   ON public.ticket_messages;
DROP POLICY IF EXISTS "ticket_messages_select_scoped"              ON public.ticket_messages;

CREATE POLICY "ticket_messages_select_scoped"
  ON public.ticket_messages FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_messages.ticket_id
        AND t.account_id = public.current_portal_account_id()
    )
  );

CREATE POLICY "ticket_messages_insert_scoped"
  ON public.ticket_messages FOR INSERT TO authenticated
  WITH CHECK (
    public.is_internal_staff()
    OR EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_messages.ticket_id
        AND t.account_id = public.current_portal_account_id()
    )
  );

-- =============================================
-- 8. Audit logs — staff only (portal denied)
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can view audit_logs"   ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_select_staff"                   ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_staff"                   ON public.audit_logs;

CREATE POLICY "audit_logs_select_staff"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_internal_staff());

CREATE POLICY "audit_logs_insert_staff"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_internal_staff());

-- =============================================
-- 9. Performance: partial indexes that accelerate portal scoping joins
-- =============================================
CREATE INDEX IF NOT EXISTS idx_clients_source_account_active
  ON public.clients (source_account_id)
  WHERE source_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_client_id_not_deleted
  ON public.jobs (client_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_client_id_active
  ON public.quotes (client_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_service_requests_client_id
  ON public.service_requests (client_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_source_account_id
  ON public.invoices (source_account_id)
  WHERE source_account_id IS NOT NULL;

-- =============================================================================
-- End of migration 142
-- =============================================================================
