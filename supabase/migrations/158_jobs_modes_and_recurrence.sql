-- =============================================================================
-- Migration 158: job modes (one_off / multi_day / recurring) + recurrence series
-- =============================================================================
--
-- Adds the 3-mode model to jobs and a separate `job_recurrence_series` table
-- for recurring patterns. Schema is fully additive — `scheduled_finish_date`
-- (mig 064) keeps being populated by the app so the partner portal continues
-- to work unchanged (portal-job-detail.ts reads it directly).
--
-- Modes:
--   - one_off:   single-day job (default for legacy rows)
--   - multi_day: contiguous range, captures `expected_finish_at` (timestamptz)
--   - recurring: each occurrence is its own row, linked via
--                `recurrence_series_id` to a row in `job_recurrence_series`
--
-- Idempotent.
-- =============================================================================

-- =============================================
-- 1. New columns on jobs
-- =============================================
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS job_kind text NOT NULL DEFAULT 'one_off',
  ADD COLUMN IF NOT EXISTS expected_finish_at timestamptz,
  ADD COLUMN IF NOT EXISTS recurrence_series_id uuid,
  ADD COLUMN IF NOT EXISTS recurrence_sequence_index integer,
  ADD COLUMN IF NOT EXISTS recurrence_detached_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_job_kind_check'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_job_kind_check
      CHECK (job_kind IN ('one_off','multi_day','recurring'));
  END IF;
END $$;

COMMENT ON COLUMN public.jobs.job_kind IS
  'Mode: one_off (single day) / multi_day (contiguous range) / recurring (one occurrence of a series).';
COMMENT ON COLUMN public.jobs.expected_finish_at IS
  'Wall-clock finish time of the work itself (not the arrival window). Different from scheduled_end_at, which remains the partner arrival window upper bound. Nullable for one_off.';
COMMENT ON COLUMN public.jobs.recurrence_series_id IS
  'FK to job_recurrence_series. NULL for one-off and multi-day jobs.';
COMMENT ON COLUMN public.jobs.recurrence_sequence_index IS
  '1-based index of this occurrence within its series. Unique per (series_id) for non-detached rows.';
COMMENT ON COLUMN public.jobs.recurrence_detached_at IS
  'Set when an operator edits a single occurrence ("edit this only"). Detached rows still keep series_id for audit but are excluded from series-wide operations.';

-- =============================================
-- 2. job_recurrence_series table
-- =============================================
CREATE TABLE IF NOT EXISTS public.job_recurrence_series (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Anchor (first job in the series). SET NULL on delete so we keep the
  -- series for audit even if the original job is purged.
  anchor_job_id       uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  -- Recurrence rule as JSON for forward-compat.
  -- Examples:
  --   { "pattern": "daily",   "interval": 1 }
  --   { "pattern": "weekly",  "interval": 2, "byday": ["MO","WE"] }
  --   { "pattern": "monthly", "interval": 1 }
  rule                jsonb NOT NULL,
  start_time          time NOT NULL,
  end_time            time NOT NULL,
  start_date          date NOT NULL,
  -- Either end_date OR max_occurrences must be set (validated app-side).
  end_date            date,
  max_occurrences     integer,
  -- Last date through which occurrences have been materialised in `jobs`.
  -- Cron extends this forward.
  generated_through   date,
  status              text NOT NULL DEFAULT 'active',
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_recurrence_series_status_check'
  ) THEN
    ALTER TABLE public.job_recurrence_series
      ADD CONSTRAINT job_recurrence_series_status_check
      CHECK (status IN ('active','paused','cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_recurrence_series_max_or_end_check'
  ) THEN
    ALTER TABLE public.job_recurrence_series
      ADD CONSTRAINT job_recurrence_series_max_or_end_check
      CHECK (end_date IS NOT NULL OR max_occurrences IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_recurrence_series_time_order_check'
  ) THEN
    ALTER TABLE public.job_recurrence_series
      ADD CONSTRAINT job_recurrence_series_time_order_check
      CHECK (end_time > start_time);
  END IF;
END $$;

-- =============================================
-- 3. FK from jobs to series + indexes
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_recurrence_series_fk'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_recurrence_series_fk
      FOREIGN KEY (recurrence_series_id)
      REFERENCES public.job_recurrence_series(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Defends expansion races: only one non-detached job per (series, sequence).
CREATE UNIQUE INDEX IF NOT EXISTS jobs_recurrence_seq_uq
  ON public.jobs (recurrence_series_id, recurrence_sequence_index)
  WHERE recurrence_series_id IS NOT NULL AND recurrence_detached_at IS NULL;

CREATE INDEX IF NOT EXISTS jobs_recurrence_series_idx
  ON public.jobs (recurrence_series_id)
  WHERE recurrence_series_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_recurrence_series_status_idx
  ON public.job_recurrence_series (status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS job_recurrence_series_horizon_idx
  ON public.job_recurrence_series (generated_through)
  WHERE status = 'active' AND deleted_at IS NULL;

-- =============================================
-- 4. updated_at touch trigger
-- =============================================
CREATE OR REPLACE FUNCTION public.touch_job_recurrence_series_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_job_recurrence_series_updated_at
  ON public.job_recurrence_series;
CREATE TRIGGER trg_touch_job_recurrence_series_updated_at
  BEFORE UPDATE ON public.job_recurrence_series
  FOR EACH ROW EXECUTE FUNCTION public.touch_job_recurrence_series_updated_at();

-- =============================================
-- 5. RLS
-- =============================================
ALTER TABLE public.job_recurrence_series ENABLE ROW LEVEL SECURITY;

-- Authenticated staff can read and write. Service role bypasses RLS.
DROP POLICY IF EXISTS "job_recurrence_series_authenticated_all"
  ON public.job_recurrence_series;
CREATE POLICY "job_recurrence_series_authenticated_all"
  ON public.job_recurrence_series
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.job_recurrence_series IS
  'Recurring job templates. Each occurrence is a separate row in jobs linked via recurrence_series_id. Hybrid expansion: eager up to 90 days, cron extends horizon.';
