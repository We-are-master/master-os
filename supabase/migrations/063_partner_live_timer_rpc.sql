-- Authoritative partner work timer: all boundaries use DB clock (clock_timestamp), single row lock, atomic updates.
-- Replaces client-side timestamps for legal / billing accuracy.

CREATE OR REPLACE FUNCTION public.partner_mark_job_in_progress_with_timer(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_partner_id uuid;
  v_job public.jobs%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_partner_id := public.get_partner_id_for_user(v_uid);
  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Only linked partners can update this job';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_job.partner_id IS DISTINCT FROM v_partner_id THEN
    RAISE EXCEPTION 'You can only update jobs assigned to you';
  END IF;
  IF v_job.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  UPDATE public.jobs
  SET
    status = 'in_progress_phase1',
    current_phase = 1,
    progress = 33,
    updated_at = v_now,
    partner_timer_started_at = v_now,
    partner_timer_ended_at = NULL,
    partner_timer_accum_paused_ms = 0,
    partner_timer_is_paused = false,
    partner_timer_pause_began_at = NULL
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'partner_timer_started_at', v_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.partner_live_timer_pause(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_partner_id uuid;
  v_job public.jobs%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_pause_began timestamptz;
  v_accum bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_partner_id := public.get_partner_id_for_user(v_uid);
  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Only linked partners can update this job';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_job.partner_id IS DISTINCT FROM v_partner_id THEN
    RAISE EXCEPTION 'You can only update jobs assigned to you';
  END IF;

  IF v_job.partner_timer_started_at IS NULL OR v_job.partner_timer_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Timer is not running';
  END IF;

  IF v_job.partner_timer_is_paused THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'partner_timer_pause_began_at', v_job.partner_timer_pause_began_at,
      'partner_timer_accum_paused_ms', COALESCE(v_job.partner_timer_accum_paused_ms, 0)
    );
  END IF;

  UPDATE public.jobs
  SET
    partner_timer_is_paused = true,
    partner_timer_pause_began_at = v_now,
    updated_at = v_now
  WHERE id = p_job_id
  RETURNING partner_timer_pause_began_at, partner_timer_accum_paused_ms
  INTO v_pause_began, v_accum;

  RETURN jsonb_build_object(
    'ok', true,
    'partner_timer_pause_began_at', v_pause_began,
    'partner_timer_accum_paused_ms', COALESCE(v_accum, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.partner_live_timer_resume(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_partner_id uuid;
  v_job public.jobs%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_delta_ms bigint;
  v_accum bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_partner_id := public.get_partner_id_for_user(v_uid);
  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Only linked partners can update this job';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_job.partner_id IS DISTINCT FROM v_partner_id THEN
    RAISE EXCEPTION 'You can only update jobs assigned to you';
  END IF;

  IF v_job.partner_timer_started_at IS NULL OR v_job.partner_timer_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Timer is not running';
  END IF;

  IF NOT COALESCE(v_job.partner_timer_is_paused, false) OR v_job.partner_timer_pause_began_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'partner_timer_accum_paused_ms', COALESCE(v_job.partner_timer_accum_paused_ms, 0),
      'partner_timer_is_paused', false
    );
  END IF;

  v_delta_ms := (EXTRACT(EPOCH FROM (v_now - v_job.partner_timer_pause_began_at)) * 1000)::bigint;
  IF v_delta_ms < 0 THEN
    v_delta_ms := 0;
  END IF;

  UPDATE public.jobs
  SET
    partner_timer_accum_paused_ms = COALESCE(v_job.partner_timer_accum_paused_ms, 0) + v_delta_ms,
    partner_timer_is_paused = false,
    partner_timer_pause_began_at = NULL,
    updated_at = v_now
  WHERE id = p_job_id
  RETURNING partner_timer_accum_paused_ms
  INTO v_accum;

  RETURN jsonb_build_object(
    'ok', true,
    'partner_timer_accum_paused_ms', COALESCE(v_accum, 0),
    'partner_timer_is_paused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.partner_live_timer_stop(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_partner_id uuid;
  v_job public.jobs%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_delta_ms bigint;
  v_accum bigint;
  v_ended timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_partner_id := public.get_partner_id_for_user(v_uid);
  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Only linked partners can update this job';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_job.partner_id IS DISTINCT FROM v_partner_id THEN
    RAISE EXCEPTION 'You can only update jobs assigned to you';
  END IF;

  IF v_job.partner_timer_started_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'reason', 'never_started');
  END IF;

  IF v_job.partner_timer_ended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'partner_timer_ended_at', v_job.partner_timer_ended_at,
      'partner_timer_accum_paused_ms', COALESCE(v_job.partner_timer_accum_paused_ms, 0)
    );
  END IF;

  v_accum := COALESCE(v_job.partner_timer_accum_paused_ms, 0);
  IF COALESCE(v_job.partner_timer_is_paused, false) AND v_job.partner_timer_pause_began_at IS NOT NULL THEN
    v_delta_ms := (EXTRACT(EPOCH FROM (v_now - v_job.partner_timer_pause_began_at)) * 1000)::bigint;
    IF v_delta_ms < 0 THEN
      v_delta_ms := 0;
    END IF;
    v_accum := v_accum + v_delta_ms;
  END IF;

  UPDATE public.jobs
  SET
    partner_timer_accum_paused_ms = v_accum,
    partner_timer_ended_at = v_now,
    partner_timer_is_paused = false,
    partner_timer_pause_began_at = NULL,
    updated_at = v_now
  WHERE id = p_job_id
  RETURNING partner_timer_ended_at, partner_timer_accum_paused_ms
  INTO v_ended, v_accum;

  RETURN jsonb_build_object(
    'ok', true,
    'partner_timer_ended_at', v_ended,
    'partner_timer_accum_paused_ms', COALESCE(v_accum, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.partner_mark_job_in_progress_with_timer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_live_timer_pause(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_live_timer_resume(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_live_timer_stop(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.partner_mark_job_in_progress_with_timer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_live_timer_pause(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_live_timer_resume(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_live_timer_stop(uuid) TO authenticated;

COMMENT ON FUNCTION public.partner_mark_job_in_progress_with_timer(uuid) IS
  'Partner app: atomically set in_progress_phase1 and start live timer using DB clock.';
COMMENT ON FUNCTION public.partner_live_timer_pause(uuid) IS
  'Partner app: pause live timer; timestamps from DB.';
COMMENT ON FUNCTION public.partner_live_timer_resume(uuid) IS
  'Partner app: resume live timer; adds pause duration using DB clock.';
COMMENT ON FUNCTION public.partner_live_timer_stop(uuid) IS
  'Partner app: end live timer session; idempotent if already ended.';
