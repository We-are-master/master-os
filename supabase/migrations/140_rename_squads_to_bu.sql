-- =============================================================================
-- Migration 137: Rename squads → business_units + add bu_id to accounts
-- =============================================================================
--
-- Organizational rename: "Squad" was an internal-only term for business
-- units (London, Midlands, etc). The company is standardising on "BU"
-- (Business Unit) to match B2B conventions. This migration:
--
--   1. Renames the squads table to business_units (PK/FK integrity preserved
--      via ALTER TABLE RENAME — all existing data and relationships intact)
--   2. Renames squad_id → bu_id columns on team_members and
--      payroll_internal_costs
--   3. Updates indexes and RLS policy names to match
--   4. Adds a new nullable bu_id column to accounts so each client-account
--      can belong to a BU. Requests/Quotes/Jobs inherit BU transitively via
--      clients.source_account_id → accounts.bu_id
--
-- Non-destructive — all data preserved.
-- =============================================================================

-- =============================================
-- 1. Rename squads → business_units
-- =============================================
ALTER TABLE IF EXISTS public.squads RENAME TO business_units;

-- =============================================
-- 2. Rename FK columns: squad_id → bu_id
-- =============================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'team_members' AND column_name = 'squad_id'
  ) THEN
    ALTER TABLE public.team_members RENAME COLUMN squad_id TO bu_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payroll_internal_costs' AND column_name = 'squad_id'
  ) THEN
    ALTER TABLE public.payroll_internal_costs RENAME COLUMN squad_id TO bu_id;
  END IF;
END $$;

-- =============================================
-- 3. Rename indexes
-- =============================================
DROP INDEX IF EXISTS public.idx_team_members_squad;
CREATE INDEX IF NOT EXISTS idx_team_members_bu
  ON public.team_members (bu_id) WHERE bu_id IS NOT NULL;

-- =============================================
-- 4. Update RLS policy names (drop old squads_* policies, create business_units_*)
-- =============================================
DROP POLICY IF EXISTS "squads_select" ON public.business_units;
DROP POLICY IF EXISTS "squads_insert" ON public.business_units;
DROP POLICY IF EXISTS "squads_update" ON public.business_units;
DROP POLICY IF EXISTS "squads_delete" ON public.business_units;

CREATE POLICY "business_units_select"
  ON public.business_units FOR SELECT TO authenticated USING (true);
CREATE POLICY "business_units_insert"
  ON public.business_units FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "business_units_update"
  ON public.business_units FOR UPDATE TO authenticated USING (true);
CREATE POLICY "business_units_delete"
  ON public.business_units FOR DELETE TO authenticated USING (true);

COMMENT ON TABLE public.business_units IS
  'Business Units (formerly "squads"). Used to group internal staff and accounts for operational segmentation (London, Midlands, etc).';

-- =============================================
-- 5. Add bu_id to accounts
-- =============================================
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS bu_id uuid REFERENCES public.business_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_bu
  ON public.accounts (bu_id) WHERE bu_id IS NOT NULL;

COMMENT ON COLUMN public.accounts.bu_id IS
  'Business Unit responsible for this account. Requests/Quotes/Jobs inherit this BU transitively via clients.source_account_id → accounts.bu_id for filtering in the dashboard.';
