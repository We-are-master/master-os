-- Live partner work timer (synced from partner app) for Master OS dashboard display.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS partner_timer_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS partner_timer_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS partner_timer_accum_paused_ms bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partner_timer_is_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partner_timer_pause_began_at timestamptz;

COMMENT ON COLUMN public.jobs.partner_timer_started_at IS 'When partner pressed Start job / timer in app';
COMMENT ON COLUMN public.jobs.partner_timer_ended_at IS 'When partner stopped timer (null = running or never started)';
COMMENT ON COLUMN public.jobs.partner_timer_accum_paused_ms IS 'Total ms paused (completed pause segments)';
COMMENT ON COLUMN public.jobs.partner_timer_is_paused IS 'Whether timer is currently paused in app';
COMMENT ON COLUMN public.jobs.partner_timer_pause_began_at IS 'Wall time when current pause started (if is_paused)';
