-- Booked / on-site rows must have a partner; otherwise they belong in Unassigned.
UPDATE jobs
SET status = 'unassigned'
WHERE deleted_at IS NULL
  AND status IN (
    'scheduled',
    'late',
    'in_progress_phase1',
    'in_progress_phase2',
    'in_progress_phase3'
  )
  AND partner_id IS NULL
  AND (partner_ids IS NULL OR partner_ids = '{}'::uuid[]);
