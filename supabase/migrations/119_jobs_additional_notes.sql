-- Optional internal context for ops (distinct from `scope` and system `internal_notes` stamps).

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS additional_notes text;

COMMENT ON COLUMN public.jobs.additional_notes IS 'Internal additional notes (office); shown near scope in job UI.';
