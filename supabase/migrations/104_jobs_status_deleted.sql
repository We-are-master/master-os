-- Distinct "deleted" stage (trash) vs "cancelled" (Lost & Cancelled). Recover restores `status` from snapshot.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS deleted_previous_status text;

COMMENT ON COLUMN public.jobs.deleted_previous_status IS
  'Job status before soft-delete; used when restoring from Deleted tab.';

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
      'deleted'
    )
  );

-- Existing soft-deleted rows → explicit deleted status (preserve prior status for recover).
UPDATE public.jobs
SET
  deleted_previous_status = COALESCE(deleted_previous_status, status),
  status = 'deleted'
WHERE deleted_at IS NOT NULL
  AND status IS DISTINCT FROM 'deleted';
