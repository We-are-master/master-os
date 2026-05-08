-- Partner app: cancel assigned job with economics zero-out (parity with office dashboard cancel)
-- and optional late-cancel clawback when cancellation is within 24h of scheduled start.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS partner_cancellation_fee_gbp numeric;

COMMENT ON COLUMN public.company_settings.partner_cancellation_fee_gbp IS
  'Default GBP clawback when the partner late-cancels from the app (within 24h of scheduled start); override per partner via partners.default_partner_cancel_fee_gbp.';

CREATE OR REPLACE FUNCTION public.partner_cancel_job(p_job_id uuid, p_reason text DEFAULT '')
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
  v_raw_start timestamptz;
  v_inside boolean := false;
  v_company_fee numeric;
  v_partner_default_fee numeric;
  v_policy numeric;
  v_fee numeric := 0;
  v_partner_accum bigint;
  v_partner_delta_ms bigint;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_partner_id := public.get_partner_id_for_user(v_uid);
  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Only linked partners can cancel jobs';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  IF v_job.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  IF v_job.partner_id IS DISTINCT FROM v_partner_id THEN
    RAISE EXCEPTION 'You can only cancel jobs assigned to you';
  END IF;

  IF v_job.status::text = 'cancelled' THEN
    IF v_job.partner_cancelled_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'partner_cancellation_fee', COALESCE(v_job.partner_cancellation_fee, 0),
        'within_late_cancel_window', false
      );
    END IF;
    RAISE EXCEPTION 'Job already cancelled';
  END IF;

  IF v_job.status::text = 'completed' THEN
    RAISE EXCEPTION 'Completed jobs cannot be cancelled';
  END IF;

  IF v_job.status::text = 'deleted' THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  IF v_job.scheduled_start_at IS NOT NULL THEN
    v_raw_start := v_job.scheduled_start_at::timestamptz;
  ELSIF v_job.scheduled_date IS NOT NULL THEN
    v_raw_start := ((v_job.scheduled_date::timestamp + TIME '12:00:00') AT TIME ZONE 'UTC');
  ELSE
    v_raw_start := NULL;
  END IF;

  IF v_raw_start IS NOT NULL AND v_now <= v_raw_start AND (v_raw_start - v_now) <= interval '24 hours' THEN
    v_inside := true;
  END IF;

  SELECT cs.partner_cancellation_fee_gbp
  INTO v_company_fee
  FROM public.company_settings cs
  ORDER BY cs.updated_at DESC NULLS LAST
  LIMIT 1;

  SELECT p.default_partner_cancel_fee_gbp INTO v_partner_default_fee FROM public.partners p WHERE p.id = v_partner_id;

  v_policy := ROUND(COALESCE(v_partner_default_fee, v_company_fee, 0)::numeric, 2);
  IF v_inside AND COALESCE(v_policy, 0) > 0 THEN
    v_fee := v_policy;
  ELSE
    v_fee := 0;
  END IF;

  v_reason := LEFT(NULLIF(btrim(COALESCE(p_reason, '')), ''), 8000);

  v_partner_accum := COALESCE(v_job.partner_timer_accum_paused_ms, 0)::bigint;
  IF COALESCE(v_job.partner_timer_is_paused, false) AND v_job.partner_timer_pause_began_at IS NOT NULL THEN
    v_partner_delta_ms := (
      extract(epoch FROM (v_now - v_job.partner_timer_pause_began_at::timestamptz)) * 1000
    )::bigint;
    IF v_partner_delta_ms > 0 THEN
      v_partner_accum := v_partner_accum + v_partner_delta_ms;
    END IF;
  END IF;

  UPDATE public.jobs
  SET
    status = 'cancelled',
    progress = 0,
    updated_at = v_now,
    partner_cancelled_at = v_now,
    partner_cancellation_reason = v_reason,
    partner_cancellation_fee = v_fee,
    client_price = 0,
    extras_amount = 0,
    partner_cost = 0,
    partner_extras_amount = 0,
    materials_cost = 0,
    partner_agreed_value = 0,
    customer_final_payment = 0,
    margin_percent = 0,
    service_value = 0,
    billed_hours = NULL,
    hourly_client_rate = NULL,
    hourly_partner_rate = NULL,
    timer_elapsed_seconds = CASE
      WHEN v_job.status::text = 'in_progress' AND COALESCE(v_job.timer_is_running, false) AND v_job.timer_last_started_at IS NOT NULL THEN
        COALESCE(v_job.timer_elapsed_seconds, 0)::bigint
        + greatest(
          0,
          floor(extract(epoch FROM (v_now - v_job.timer_last_started_at::timestamptz)))::bigint
        )
      ELSE COALESCE(v_job.timer_elapsed_seconds, 0)::bigint
    END,
    timer_is_running = false,
    timer_last_started_at = NULL,
    partner_timer_accum_paused_ms = CASE
      WHEN v_job.partner_timer_started_at IS NOT NULL AND v_job.partner_timer_ended_at IS NULL THEN v_partner_accum
      ELSE COALESCE(v_job.partner_timer_accum_paused_ms, 0)
    END,
    partner_timer_ended_at = CASE
      WHEN v_job.partner_timer_started_at IS NOT NULL AND v_job.partner_timer_ended_at IS NULL THEN v_now
      ELSE v_job.partner_timer_ended_at
    END,
    partner_timer_is_paused = CASE
      WHEN v_job.partner_timer_started_at IS NOT NULL AND v_job.partner_timer_ended_at IS NULL THEN false
      ELSE COALESCE(v_job.partner_timer_is_paused, false)
    END,
    partner_timer_pause_began_at = CASE
      WHEN v_job.partner_timer_started_at IS NOT NULL AND v_job.partner_timer_ended_at IS NULL THEN NULL
      ELSE v_job.partner_timer_pause_began_at
    END
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'partner_cancellation_fee', v_fee,
    'within_late_cancel_window', v_inside
  );
END;
$$;

REVOKE ALL ON FUNCTION public.partner_cancel_job(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.partner_cancel_job(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.partner_cancel_job(uuid, text) IS
  'Partner app: atomic cancel — zero quoted-work economics on the job, optional late-cancel fee (positive GBP owed to office) within 24h of scheduled start, partner live timer + office elapsed timer freeze. Typical flow: Authenticated RPC, then POST /api/app/partner-cancel-job completes invoice + self-bill void with service role.';
