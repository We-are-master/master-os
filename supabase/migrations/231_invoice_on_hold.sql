-- Invoice on hold mirrors linked job on hold (restored on job resume).

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS on_hold_previous_status text NULL;

COMMENT ON COLUMN public.invoices.on_hold_previous_status IS
  'Invoice status before job hold; restored when job resumes from on_hold.';

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (
    status IN (
      'draft',
      'paid',
      'pending',
      'partially_paid',
      'overdue',
      'cancelled',
      'audit_required',
      'on_hold'
    )
  );

COMMENT ON COLUMN public.invoices.status IS
  'draft = not issued; on_hold = job paused; pending/overdue = collecting.';

-- Backfill: jobs already on hold → hold linked open invoices.
UPDATE public.invoices i
SET
  on_hold_previous_status = i.status,
  status = 'on_hold'
FROM public.jobs j
WHERE i.job_reference = j.reference
  AND j.status = 'on_hold'
  AND j.deleted_at IS NULL
  AND i.deleted_at IS NULL
  AND i.status NOT IN ('paid', 'cancelled', 'on_hold');

NOTIFY pgrst, 'reload schema';
