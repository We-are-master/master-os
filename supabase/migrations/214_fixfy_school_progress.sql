-- Fixfy School: per-profile progress + quiz attempt history.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS fixfy_school_xp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fixfy_school_certified_phases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fixfy_school_last_activity_at timestamptz NULL;

COMMENT ON COLUMN public.profiles.fixfy_school_xp IS
  'Total XP earned from completed Fixfy School lessons (denormalized from fixfy_school_progress).';
COMMENT ON COLUMN public.profiles.fixfy_school_certified_phases IS
  'Phase ids with quiz passed 5/5: zendesk, fixfy-os, trade-portal.';
COMMENT ON COLUMN public.profiles.fixfy_school_last_activity_at IS
  'Last lesson complete or quiz attempt in Fixfy School.';

CREATE TABLE IF NOT EXISTS public.fixfy_school_progress (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  completed_lesson_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_lesson_id text NULL,
  unlocked_at jsonb NOT NULL DEFAULT '{"zendesk": null}'::jsonb,
  quiz_stars jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_xp_earned integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fixfy_school_progress IS
  'One row per internal staff profile — Fixfy School lesson + quiz progress.';

CREATE TABLE IF NOT EXISTS public.fixfy_school_quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phase_id text NOT NULL CHECK (phase_id IN ('zendesk', 'fixfy-os', 'trade-portal')),
  stars integer NOT NULL CHECK (stars >= 0 AND stars <= 5),
  passed boolean NOT NULL DEFAULT false,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fixfy_school_quiz_attempts IS
  'Every phase quiz submission — question ids, selected/correct indices, score.';

CREATE INDEX IF NOT EXISTS fixfy_school_quiz_attempts_profile_created_idx
  ON public.fixfy_school_quiz_attempts (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS fixfy_school_quiz_attempts_phase_idx
  ON public.fixfy_school_quiz_attempts (profile_id, phase_id, created_at DESC);

ALTER TABLE public.fixfy_school_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixfy_school_quiz_attempts ENABLE ROW LEVEL SECURITY;

-- Own row read/write
CREATE POLICY fixfy_school_progress_own ON public.fixfy_school_progress
  FOR ALL
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY fixfy_school_quiz_attempts_own_select ON public.fixfy_school_quiz_attempts
  FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY fixfy_school_quiz_attempts_own_insert ON public.fixfy_school_quiz_attempts
  FOR INSERT
  WITH CHECK (profile_id = auth.uid());

-- Admins/managers can read team school data
CREATE POLICY fixfy_school_progress_staff_read ON public.fixfy_school_progress
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'manager')
    )
  );

CREATE POLICY fixfy_school_quiz_attempts_staff_read ON public.fixfy_school_quiz_attempts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'manager')
    )
  );
