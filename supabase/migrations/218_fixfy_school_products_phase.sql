-- Migration 218: Add fixfy-products phase to Fixfy School quiz constraints.

ALTER TABLE public.fixfy_school_quiz_attempts
  DROP CONSTRAINT IF EXISTS fixfy_school_quiz_attempts_phase_id_check;

ALTER TABLE public.fixfy_school_quiz_attempts
  ADD CONSTRAINT fixfy_school_quiz_attempts_phase_id_check
  CHECK (phase_id IN ('fixfy-products', 'zendesk', 'fixfy-os', 'trade-portal'));

COMMENT ON COLUMN public.profiles.fixfy_school_certified_phases IS
  'Phase ids with quiz passed 5/5: fixfy-products, zendesk, fixfy-os, trade-portal.';

-- Extend phase_id validation in the quiz RPC (signature unchanged from mig 215).
CREATE OR REPLACE FUNCTION public.record_fixfy_school_quiz_attempt(
  p_profile_id uuid,
  p_phase_id text,
  p_stars integer,
  p_passed boolean,
  p_answers jsonb,
  p_completed_lesson_ids text[],
  p_last_lesson_id text,
  p_unlocked_at jsonb,
  p_quiz_stars jsonb,
  p_total_xp_earned integer,
  p_certified_phases text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id uuid;
  v_now timestamptz := now();
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_id is required';
  END IF;

  IF p_phase_id NOT IN ('fixfy-products', 'zendesk', 'fixfy-os', 'trade-portal') THEN
    RAISE EXCEPTION 'invalid phase_id: %', p_phase_id;
  END IF;

  IF p_stars IS NULL OR p_stars < 0 OR p_stars > 5 THEN
    RAISE EXCEPTION 'invalid stars (0-5): %', p_stars;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RAISE EXCEPTION 'profile not found: %', p_profile_id;
  END IF;

  INSERT INTO public.fixfy_school_quiz_attempts (
    profile_id, phase_id, stars, passed, answers, created_at
  ) VALUES (
    p_profile_id, p_phase_id, p_stars, COALESCE(p_passed, false), COALESCE(p_answers, '[]'::jsonb), v_now
  )
  RETURNING id INTO v_attempt_id;

  INSERT INTO public.fixfy_school_progress (
    profile_id,
    completed_lesson_ids,
    last_lesson_id,
    unlocked_at,
    quiz_stars,
    total_xp_earned,
    created_at,
    updated_at
  ) VALUES (
    p_profile_id,
    COALESCE(p_completed_lesson_ids, '{}'::text[]),
    p_last_lesson_id,
    COALESCE(p_unlocked_at, '{"zendesk": null}'::jsonb),
    COALESCE(p_quiz_stars, '{}'::jsonb),
    COALESCE(p_total_xp_earned, 0),
    v_now,
    v_now
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    completed_lesson_ids = EXCLUDED.completed_lesson_ids,
    last_lesson_id = EXCLUDED.last_lesson_id,
    unlocked_at = EXCLUDED.unlocked_at,
    quiz_stars = EXCLUDED.quiz_stars,
    total_xp_earned = EXCLUDED.total_xp_earned,
    updated_at = v_now;

  UPDATE public.profiles
  SET
    fixfy_school_xp = COALESCE(p_total_xp_earned, 0),
    fixfy_school_certified_phases = COALESCE(p_certified_phases, '{}'::text[]),
    fixfy_school_last_activity_at = v_now,
    updated_at = v_now
  WHERE id = p_profile_id;

  RETURN v_attempt_id;
END;
$$;
