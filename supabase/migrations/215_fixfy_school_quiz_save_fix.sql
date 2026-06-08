-- Fix Fixfy School quiz persistence: grants, idempotent policies, text[] lesson ids, atomic RPC.

-- completed_lesson_ids: jsonb → text[] (matches app string[] and phase ids like fixfy-os)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'fixfy_school_progress'
      AND column_name = 'completed_lesson_ids'
      AND udt_name = 'jsonb'
  ) THEN
    ALTER TABLE public.fixfy_school_progress
      ALTER COLUMN completed_lesson_ids TYPE text[]
      USING (
        CASE
          WHEN jsonb_typeof(completed_lesson_ids) = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(completed_lesson_ids))
          ELSE '{}'::text[]
        END
      );
  END IF;
END $$;

ALTER TABLE public.fixfy_school_progress
  ALTER COLUMN completed_lesson_ids SET DEFAULT '{}'::text[];

COMMENT ON COLUMN public.fixfy_school_progress.completed_lesson_ids IS
  'Lesson ids marked complete — text[] (e.g. fixfy-os-welcome). Use ARRAY[''fixfy-os''] in SQL, not {fixfy-os}.';

-- Idempotent RLS + grants (214 omitted GRANT and DROP POLICY IF EXISTS)
ALTER TABLE public.fixfy_school_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixfy_school_quiz_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fixfy_school_progress_own ON public.fixfy_school_progress;
CREATE POLICY fixfy_school_progress_own ON public.fixfy_school_progress
  FOR ALL TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS fixfy_school_quiz_attempts_own_select ON public.fixfy_school_quiz_attempts;
CREATE POLICY fixfy_school_quiz_attempts_own_select ON public.fixfy_school_quiz_attempts
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS fixfy_school_quiz_attempts_own_insert ON public.fixfy_school_quiz_attempts;
CREATE POLICY fixfy_school_quiz_attempts_own_insert ON public.fixfy_school_quiz_attempts
  FOR INSERT TO authenticated
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS fixfy_school_progress_staff_read ON public.fixfy_school_progress;
CREATE POLICY fixfy_school_progress_staff_read ON public.fixfy_school_progress
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS fixfy_school_quiz_attempts_staff_read ON public.fixfy_school_quiz_attempts;
CREATE POLICY fixfy_school_quiz_attempts_staff_read ON public.fixfy_school_quiz_attempts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'manager')
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.fixfy_school_progress TO authenticated;
GRANT SELECT, INSERT ON public.fixfy_school_quiz_attempts TO authenticated;

-- One SQL entry point per quiz submission: attempt row + progress upsert + profile summary.
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

  IF p_phase_id NOT IN ('zendesk', 'fixfy-os', 'trade-portal') THEN
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

COMMENT ON FUNCTION public.record_fixfy_school_quiz_attempt IS
  'Atomically saves one Fixfy School quiz attempt, progress row, and profile summary. Called from /api/school/quiz-attempt (service role).';

REVOKE ALL ON FUNCTION public.record_fixfy_school_quiz_attempt(
  uuid, text, integer, boolean, jsonb, text[], text, jsonb, jsonb, integer, text[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_fixfy_school_quiz_attempt(
  uuid, text, integer, boolean, jsonb, text[], text, jsonb, jsonb, integer, text[]
) TO service_role;
