-- =============================================================================
-- Migration 152: portal-scoped performance indexes
-- =============================================================================
--
-- Once the RLS policies in 148-151 are applied, every portal-facing
-- query filters by source_account_id (or drills into it via a JOIN).
-- Today's index coverage is good but has two hot gaps:
--
-- 1. invoices.source_account_id has no index — RLS EXISTS predicates and
--    the portal-invoices.ts fetcher both scan the full table when the
--    account has many rows. Adding this removes a seq scan on every
--    portal invoice page load.
-- 2. tickets list UIs order by updated_at DESC. Existing
--    idx_tickets_account_status supports status filters but not "show
--    my account's most recently updated tickets". Composite on
--    (account_id, updated_at DESC) serves that common access path.
--
-- Everything is CREATE INDEX IF NOT EXISTS so re-running is a no-op.
-- No ALTER — purely additive. Can be applied before or after the
-- tenancy RLS migrations.
-- =============================================================================

-- =============================================
-- 1. invoices by source_account_id
-- =============================================
-- Partial index (deleted_at IS NULL) mirrors the existing
-- idx_invoices_status_active convention so Postgres keeps using the
-- partial-index optimisation when the app filters on active rows.
CREATE INDEX IF NOT EXISTS idx_invoices_source_account_id_active
  ON public.invoices (source_account_id)
  WHERE deleted_at IS NULL;

-- Composite to cover the "my account's pending invoices" access path
-- used by portal-invoices.ts. Postgres will pick this over the
-- single-column invoices_status_active index when both predicates
-- are present.
CREATE INDEX IF NOT EXISTS idx_invoices_source_account_status_active
  ON public.invoices (source_account_id, status)
  WHERE deleted_at IS NULL;

-- =============================================
-- 2. tickets list ordering
-- =============================================
-- Portal and staff ticket list views both show newest-updated-first.
-- The existing (account_id, status) index doesn't satisfy an ORDER BY
-- updated_at DESC without a sort step; the new composite does.
CREATE INDEX IF NOT EXISTS idx_tickets_account_updated
  ON public.tickets (account_id, updated_at DESC);

-- =============================================
-- 3. quote_line_items / job_payments / job_reports FK lookups
-- =============================================
-- RLS 151 walks these via quote_id / job_id to clients.source_account_id.
-- The PKs cover the equality join side, but let's ensure the FK
-- columns themselves are indexed for hot subquery use.
CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote_id
  ON public.quote_line_items (quote_id);

CREATE INDEX IF NOT EXISTS idx_job_payments_job_id
  ON public.job_payments (job_id);

CREATE INDEX IF NOT EXISTS idx_job_reports_job_id
  ON public.job_reports (job_id);

-- =============================================
-- 4. account_portal_users lookup via account_id
-- =============================================
-- Already indexed by account_id in migration 131 — noted here for
-- completeness. current_portal_account_id() is keyed on the PK (id),
-- which is the fast path, so no additional index needed.

-- NOTE:
-- idx_audit_entity_time on (entity_type, entity_id, created_at DESC)
-- already exists (from an earlier migration), so the EXISTS subqueries
-- in audit_logs_select_scoped (mig 151) have the index they need.
