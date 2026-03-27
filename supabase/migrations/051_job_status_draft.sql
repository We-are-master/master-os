-- Allow jobs in "draft" and "cancelled", with cancellation audit fields.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid;

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_status_check CHECK (
    status IN (
      'draft',
      'scheduled',
      'late',
      'in_progress_phase1',
      'in_progress_phase2',
      'in_progress_phase3',
      'final_check',
      'awaiting_payment',
      'need_attention',
      'completed',
      'cancelled'
    )
  );
