-- On-hold workflow: snapshot schedule + previous status; resume restores status and dates.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS on_hold_previous_status text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS on_hold_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS on_hold_reason text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS on_hold_snapshot_scheduled_date date;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS on_hold_snapshot_scheduled_start_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS on_hold_snapshot_scheduled_end_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS on_hold_snapshot_scheduled_finish_date date;

COMMENT ON COLUMN public.jobs.on_hold_previous_status IS 'Workflow status before office put the job on hold (restored on resume).';
COMMENT ON COLUMN public.jobs.on_hold_at IS 'When the job was placed on hold.';
COMMENT ON COLUMN public.jobs.on_hold_reason IS 'Office reason shown when resuming.';
COMMENT ON COLUMN public.jobs.on_hold_snapshot_scheduled_date IS 'Copy of scheduled_date at hold time.';
COMMENT ON COLUMN public.jobs.on_hold_snapshot_scheduled_start_at IS 'Copy of scheduled_start_at at hold time.';
COMMENT ON COLUMN public.jobs.on_hold_snapshot_scheduled_end_at IS 'Copy of scheduled_end_at at hold time.';
COMMENT ON COLUMN public.jobs.on_hold_snapshot_scheduled_finish_date IS 'Copy of scheduled_finish_date at hold time.';

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_status_check CHECK (
    status IN (
      'draft',
      'unassigned',
      'auto_assigning',
      'scheduled',
      'late',
      'in_progress_phase1',
      'in_progress_phase2',
      'in_progress_phase3',
      'final_check',
      'awaiting_payment',
      'need_attention',
      'completed',
      'cancelled',
      'deleted',
      'on_hold'
    )
  );
