-- =============================================================================
-- Migration 148: Portal tenancy foundation
-- =============================================================================
--
-- Adds the two helper functions every portal-scoped RLS policy in
-- migrations 149/150/151 depends on, plus creates the portal_notifications
-- table the client portal already queries (via /api/notifications) even
-- though nothing in prod ever created it.
--
-- Why:
-- - `is_internal_staff()` and `current_portal_account_id()` are the
--   canonical way to branch RLS between staff, portal users and
--   partners. Defining them here once means every policy after this
--   references the same ground truth.
-- - `portal_notifications` does not exist in prod — the client portal
--   code tries to read from it and silently returns empty. We create
--   it fresh with RLS already scoped from day one (no permissive
--   policy cleanup needed later).
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- =============================================
-- 1. Helper: is_internal_staff
-- =============================================
-- Internal staff = row in public.profiles keyed on auth.users.id.
-- Partners live in public.users, portal users live in public.account_portal_users.
-- This keeps the three populations strictly separate.
CREATE OR REPLACE FUNCTION public.is_internal_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid()
  )
$$;

COMMENT ON FUNCTION public.is_internal_staff() IS
  'RLS helper: true when auth.uid() has a row in public.profiles (internal staff). Called from every policy that needs to let dashboard users see everything.';

-- =============================================
-- 2. Helper: current_portal_account_id
-- =============================================
-- Returns the account_id for the calling portal user, or NULL if the
-- caller is not a portal user. Used by downstream RLS to scope rows to
-- a single tenant without trusting application-layer filters.
--
-- SECURITY DEFINER is required so the function itself can read
-- account_portal_users even before its own RLS permits the caller to
-- (avoids chicken-and-egg recursion).
CREATE OR REPLACE FUNCTION public.current_portal_account_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_id
  FROM public.account_portal_users
  WHERE id = auth.uid()
    AND is_active = true
  LIMIT 1
$$;

COMMENT ON FUNCTION public.current_portal_account_id() IS
  'RLS helper: returns account_id of the authenticated portal user, or NULL for staff/partners/anonymous. Safe to use in USING clauses — NULL never matches a real uuid so non-portal callers see 0 rows.';

GRANT EXECUTE ON FUNCTION public.is_internal_staff()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_portal_account_id()   TO authenticated;

-- =============================================
-- 3. Table: portal_notifications (new)
-- =============================================
-- Per-account notification feed shown in the portal topbar. A NULL
-- portal_user_id means the notification is broadcast to every user in
-- the account (e.g. SLA breach); a specific uuid means it's only for
-- that user (e.g. "your request was approved").
--
-- Inserts come from backend jobs (service role bypasses RLS, no policy
-- needed for INSERT). Reads + UPDATE (mark-as-read) are RLS-scoped.
CREATE TABLE IF NOT EXISTS public.portal_notifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  portal_user_id  uuid        REFERENCES public.account_portal_users(id) ON DELETE CASCADE,
  type            text        NOT NULL,
  title           text        NOT NULL,
  body            text        NOT NULL DEFAULT '',
  link_url        text,
  entity_type     text,
  entity_id       text,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_notifications_account_unread
  ON public.portal_notifications (account_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portal_notifications_user
  ON public.portal_notifications (portal_user_id, created_at DESC)
  WHERE portal_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_portal_notifications_account_created
  ON public.portal_notifications (account_id, created_at DESC);

COMMENT ON TABLE public.portal_notifications IS
  'Per-account notifications surfaced in the client portal topbar. portal_user_id NULL = broadcast to whole account; set = targeted to that one user.';

-- =============================================
-- 4. RLS on portal_notifications
-- =============================================
ALTER TABLE public.portal_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portal_notifs_select"       ON public.portal_notifications;
DROP POLICY IF EXISTS "portal_notifs_update_read"  ON public.portal_notifications;

-- SELECT: staff see all; portal user sees own account + (broadcast OR own).
CREATE POLICY "portal_notifs_select"
  ON public.portal_notifications FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR (
      account_id = public.current_portal_account_id()
      AND (portal_user_id IS NULL OR portal_user_id = auth.uid())
    )
  );

-- UPDATE: portal user can mark-as-read notifications they can see.
-- Staff update happens via service role.
CREATE POLICY "portal_notifs_update_read"
  ON public.portal_notifications FOR UPDATE TO authenticated
  USING (
    account_id = public.current_portal_account_id()
    AND (portal_user_id IS NULL OR portal_user_id = auth.uid())
  )
  WITH CHECK (
    account_id = public.current_portal_account_id()
    AND (portal_user_id IS NULL OR portal_user_id = auth.uid())
  );

-- INSERT + DELETE intentionally omitted — only the service role (backend
-- jobs, webhooks) creates notifications; portal users never delete.

GRANT SELECT, UPDATE ON public.portal_notifications TO authenticated;
