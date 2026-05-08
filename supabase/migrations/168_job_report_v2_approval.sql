-- Migration 168: V2 job report approval workflow
--
-- The V2 report system (start_report / final_report JSONB on jobs) replaces
-- the legacy phase-based reports (mig 162 deprecation). Office staff still
-- need to validate each report — adds approval tracking columns paired with
-- the existing JSONB report payloads.
--
-- Derive `approved` from `approved_at IS NOT NULL`. We don't store a
-- separate boolean to avoid drift.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS start_report_approved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS start_report_approved_by  uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS final_report_approved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS final_report_approved_by  uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.jobs.start_report_approved_at IS
  'Set when an internal user validates the V2 start_report payload (replaces legacy report_N_approved). null = pending review.';
COMMENT ON COLUMN public.jobs.start_report_approved_by IS
  'profiles.id of the user who approved the start report (set with start_report_approved_at).';
COMMENT ON COLUMN public.jobs.final_report_approved_at IS
  'Set when an internal user validates the V2 final_report payload. null = pending review.';
COMMENT ON COLUMN public.jobs.final_report_approved_by IS
  'profiles.id of the user who approved the final report (set with final_report_approved_at).';
