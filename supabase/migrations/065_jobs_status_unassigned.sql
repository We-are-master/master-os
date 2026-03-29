-- Jobs without a partner use status `unassigned` until a partner is assigned (then `scheduled`).
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_status_check CHECK (
    status IN (
      'draft',
      'unassigned',
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

UPDATE public.jobs
SET status = 'unassigned'
WHERE deleted_at IS NULL
  AND status = 'scheduled'
  AND partner_id IS NULL
  AND (partner_name IS NULL OR btrim(partner_name) = '');
