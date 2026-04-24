-- =============================================================================
-- Migration 148: Job extras ledger (client + partner)
-- =============================================================================
--
-- Purpose:
--   Track each extra as its own row so teams can add multiple extras per job,
--   keep an auditable archive, and soft-delete individual entries safely.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.job_extra_entries (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  side              text        NOT NULL CHECK (side IN ('client', 'partner')),
  extra_type        text        NOT NULL,
  reason            text        NOT NULL,
  amount            numeric(12,2) NOT NULL CHECK (amount > 0),
  allocation        text        NOT NULL CHECK (allocation IN ('extras', 'materials', 'partner_cost')),
  linked_group_id   uuid,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  deleted_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_by_name   text,
  deleted_reason    text
);

CREATE INDEX IF NOT EXISTS idx_job_extra_entries_job_active_created
  ON public.job_extra_entries (job_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_extra_entries_linked_group
  ON public.job_extra_entries (linked_group_id)
  WHERE linked_group_id IS NOT NULL;

ALTER TABLE public.job_extra_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read job_extra_entries" ON public.job_extra_entries;
CREATE POLICY "Authenticated read job_extra_entries"
  ON public.job_extra_entries FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert job_extra_entries" ON public.job_extra_entries;
CREATE POLICY "Authenticated insert job_extra_entries"
  ON public.job_extra_entries FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated update job_extra_entries" ON public.job_extra_entries;
CREATE POLICY "Authenticated update job_extra_entries"
  ON public.job_extra_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.job_extra_entries TO authenticated;

COMMENT ON TABLE public.job_extra_entries IS
  'Ledger of per-entry extras for jobs (client extra charges and partner extra payouts). Soft-delete only.';
