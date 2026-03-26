-- Add account contract storage + job workflow/type enhancements

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS contract_url text;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS partner_ids uuid[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF to_regclass('public.quote_bids') IS NOT NULL THEN
    ALTER TABLE public.quote_bids
      ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'fixed';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_job_type_check'
      AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_job_type_check CHECK (job_type IN ('fixed', 'hourly'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.quote_bids') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'quote_bids_job_type_check'
        AND conrelid = 'public.quote_bids'::regclass
    ) THEN
      ALTER TABLE public.quote_bids
        ADD CONSTRAINT quote_bids_job_type_check CHECK (job_type IN ('fixed', 'hourly'));
    END IF;
  END IF;
END $$;

-- Ensure "late" is accepted in installations that enforce status values via CHECK.
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_status_check CHECK (
    status IN (
      'scheduled',
      'late',
      'in_progress_phase1',
      'in_progress_phase2',
      'in_progress_phase3',
      'final_check',
      'awaiting_payment',
      'need_attention',
      'completed'
    )
  );
