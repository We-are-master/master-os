import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchoolPhaseId } from "@/lib/fixfy-school-curriculum";
import type { SchoolQuizAttemptAnswer } from "@/lib/fixfy-school-db";
import type { SchoolProgress } from "@/lib/fixfy-school-progress";

export type RecordSchoolQuizAttemptInput = {
  profileId: string;
  phaseId: SchoolPhaseId;
  stars: number;
  passed: boolean;
  answers: SchoolQuizAttemptAnswer[];
  progress: SchoolProgress;
  totalXpEarned: number;
  certifiedPhases: SchoolPhaseId[];
};

/** Prefer atomic RPC (migration 215); fall back to sequential writes if not deployed yet. */
export async function recordSchoolQuizAttemptAdmin(
  supabase: SupabaseClient,
  input: RecordSchoolQuizAttemptInput,
): Promise<{ attemptId: string }> {
  const now = new Date().toISOString();
  const { data: rpcId, error: rpcErr } = await supabase.rpc("record_fixfy_school_quiz_attempt", {
    p_profile_id: input.profileId,
    p_phase_id: input.phaseId,
    p_stars: input.stars,
    p_passed: input.passed,
    p_answers: input.answers,
    p_completed_lesson_ids: input.progress.completedLessonIds,
    p_last_lesson_id: input.progress.lastLessonId,
    p_unlocked_at: input.progress.unlockedAt,
    p_quiz_stars: input.progress.quizStars,
    p_total_xp_earned: input.totalXpEarned,
    p_certified_phases: input.certifiedPhases,
  });

  if (!rpcErr && rpcId) {
    return { attemptId: String(rpcId) };
  }

  const rpcMissing =
    rpcErr &&
    (rpcErr.code === "PGRST202" ||
      rpcErr.code === "42883" ||
      /record_fixfy_school_quiz_attempt/i.test(rpcErr.message ?? ""));

  if (rpcErr && !rpcMissing) {
    throw rpcErr;
  }

  const { data: attempt, error: attemptErr } = await supabase
    .from("fixfy_school_quiz_attempts")
    .insert({
      profile_id: input.profileId,
      phase_id: input.phaseId,
      stars: input.stars,
      passed: input.passed,
      answers: input.answers,
      created_at: now,
    })
    .select("id")
    .single();

  if (attemptErr) throw attemptErr;

  const { data: existing } = await supabase
    .from("fixfy_school_progress")
    .select("created_at")
    .eq("profile_id", input.profileId)
    .maybeSingle();

  const { error: upsertErr } = await supabase.from("fixfy_school_progress").upsert(
    {
      profile_id: input.profileId,
      completed_lesson_ids: input.progress.completedLessonIds,
      last_lesson_id: input.progress.lastLessonId,
      unlocked_at: input.progress.unlockedAt,
      quiz_stars: input.progress.quizStars,
      total_xp_earned: input.totalXpEarned,
      created_at: (existing as { created_at?: string } | null)?.created_at ?? now,
      updated_at: now,
    },
    { onConflict: "profile_id" },
  );

  if (upsertErr) throw upsertErr;

  const { error: profileErr } = await supabase
    .from("profiles")
    .update({
      fixfy_school_xp: input.totalXpEarned,
      fixfy_school_certified_phases: input.certifiedPhases,
      fixfy_school_last_activity_at: now,
      updated_at: now,
    })
    .eq("id", input.profileId);

  if (profileErr) throw profileErr;

  return { attemptId: (attempt as { id: string }).id };
}
