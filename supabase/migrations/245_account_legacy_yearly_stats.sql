-- =============================================================================
-- Migration 245: per-account legacy yearly stats (pre–Master OS history)
-- =============================================================================
-- Manual rows: calendar year, completed jobs count, revenue from the previous
-- system. Combined in the dashboard with OS completed jobs for relationship
-- insights (customer since, avg ticket, all-time totals).

CREATE TABLE IF NOT EXISTS public.account_legacy_yearly_stats (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  year                  int NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  completed_jobs_count  int NOT NULL DEFAULT 0 CHECK (completed_jobs_count >= 0),
  revenue_gbp           numeric(12, 2) NOT NULL DEFAULT 0 CHECK (revenue_gbp >= 0),
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_stats_account_year_active
  ON public.account_legacy_yearly_stats (account_id, year)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_legacy_stats_account_year
  ON public.account_legacy_yearly_stats (account_id, year DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.account_legacy_yearly_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "legacy_stats_select_scoped" ON public.account_legacy_yearly_stats;
CREATE POLICY "legacy_stats_select_scoped"
  ON public.account_legacy_yearly_stats FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR account_id = public.current_portal_account_id()
  );

DROP POLICY IF EXISTS "legacy_stats_staff_write" ON public.account_legacy_yearly_stats;
CREATE POLICY "legacy_stats_staff_write"
  ON public.account_legacy_yearly_stats FOR ALL TO authenticated
  USING (public.is_internal_staff())
  WITH CHECK (public.is_internal_staff());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_legacy_yearly_stats TO authenticated;

COMMENT ON TABLE public.account_legacy_yearly_stats IS
  'Yearly completed-job counts and revenue imported from the previous system. Staff edit via Accounts overview; portal users may read their own account rows.';
