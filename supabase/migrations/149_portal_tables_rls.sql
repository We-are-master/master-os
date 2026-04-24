-- =============================================================================
-- Migration 149: tighten RLS on portal-only tables
-- =============================================================================
--
-- Tables account_portal_users, tickets and ticket_messages (created in
-- migrations 131-133) shipped with `USING (true)` policies — any
-- authenticated user (portal or partner) can read all rows across every
-- tenant. This migration replaces them with scoped policies that lean
-- on the helpers from migration 148.
--
-- Ownership model:
--   - Staff (public.profiles)        → see everything.
--   - Portal users (account_portal_users) → see / act on rows for
--     their own account only.
--   - Partners (public.users) → no access to portal tables (they have
--     their own comms channel in the app).
--
-- All writes from portal API routes continue to go through the service
-- role client (bypasses RLS). These policies are defense-in-depth for
-- when code accidentally uses the anon client or a future migration
-- switches routes over.
-- =============================================================================

-- =============================================
-- 1. account_portal_users
-- =============================================
-- Keep "Portal users read/update own row" policies; replace
-- "Authenticated read all portal users" with a scoped one so a portal
-- user can see teammates in the same account (team view) but never
-- another account's users, while staff can still list all.
DROP POLICY IF EXISTS "Authenticated read all portal users" ON public.account_portal_users;

DROP POLICY IF EXISTS "portal_users_account_select" ON public.account_portal_users;
CREATE POLICY "portal_users_account_select"
  ON public.account_portal_users FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR account_id = public.current_portal_account_id()
  );

-- Leaves in place (from mig 131):
--   "Portal users read own row"    — USING (id = auth.uid())
--   "Portal users update own row"  — USING (id = auth.uid())
-- The new account-wide SELECT is additive (Postgres OR-combines all
-- permissive policies) so a user still sees their own row even if the
-- account-wide check fails for whatever reason.

-- =============================================
-- 2. tickets
-- =============================================
DROP POLICY IF EXISTS "Authenticated can read all tickets"    ON public.tickets;
DROP POLICY IF EXISTS "Authenticated can insert tickets"      ON public.tickets;
DROP POLICY IF EXISTS "Authenticated can update tickets"      ON public.tickets;

DROP POLICY IF EXISTS "tickets_select_scoped" ON public.tickets;
CREATE POLICY "tickets_select_scoped"
  ON public.tickets FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR account_id = public.current_portal_account_id()
  );

DROP POLICY IF EXISTS "tickets_insert_scoped" ON public.tickets;
CREATE POLICY "tickets_insert_scoped"
  ON public.tickets FOR INSERT TO authenticated
  WITH CHECK (
    public.is_internal_staff()
    OR (
      account_id = public.current_portal_account_id()
      AND created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tickets_update_scoped" ON public.tickets;
CREATE POLICY "tickets_update_scoped"
  ON public.tickets FOR UPDATE TO authenticated
  USING (
    public.is_internal_staff()
    OR account_id = public.current_portal_account_id()
  )
  WITH CHECK (
    public.is_internal_staff()
    OR account_id = public.current_portal_account_id()
  );

-- DELETE = staff only (no policy for authenticated; falls back to
-- service role bypass if a backend job needs to hard-delete).

-- =============================================
-- 3. ticket_messages
-- =============================================
DROP POLICY IF EXISTS "Authenticated can read all ticket messages"   ON public.ticket_messages;
DROP POLICY IF EXISTS "Authenticated can insert ticket messages"     ON public.ticket_messages;

DROP POLICY IF EXISTS "ticket_msgs_select_scoped" ON public.ticket_messages;
CREATE POLICY "ticket_msgs_select_scoped"
  ON public.ticket_messages FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_messages.ticket_id
        AND t.account_id = public.current_portal_account_id()
    )
  );

-- Portal user can only post messages as themselves into tickets that
-- belong to their account. Staff messages are written via service role.
DROP POLICY IF EXISTS "ticket_msgs_insert_scoped" ON public.ticket_messages;
CREATE POLICY "ticket_msgs_insert_scoped"
  ON public.ticket_messages FOR INSERT TO authenticated
  WITH CHECK (
    (
      sender_type = 'portal_user'
      AND sender_id  = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.tickets t
        WHERE t.id = ticket_messages.ticket_id
          AND t.account_id = public.current_portal_account_id()
      )
    )
    OR public.is_internal_staff()
  );
