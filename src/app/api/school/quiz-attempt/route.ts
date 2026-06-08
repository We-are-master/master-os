import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import {
  certifiedPhaseIds,
  isValidPhaseId,
  parseQuizAnswers,
  rowToSchoolProgress,
  schoolProgressToRow,
  type SchoolProgressRow,
} from "@/lib/fixfy-school-db";
import { SCHOOL_QUIZ_PASS_STARS } from "@/lib/fixfy-school-quizzes";
import type { SchoolProgress } from "@/lib/fixfy-school-progress";
import type { SchoolPhaseId } from "@/lib/fixfy-school-curriculum";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/school/quiz-attempt
 * Records each quiz submission (answers + score) and updates best stars on progress.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const phaseId = typeof body.phaseId === "string" ? body.phaseId.trim() : "";
  const stars = Number(body.stars);
  if (!isValidPhaseId(phaseId)) {
    return NextResponse.json({ error: "Invalid phaseId." }, { status: 400 });
  }
  if (!Number.isInteger(stars) || stars < 0 || stars > SCHOOL_QUIZ_PASS_STARS) {
    return NextResponse.json({ error: "Invalid stars (0-5)." }, { status: 400 });
  }

  const answers = parseQuizAnswers(body.answers);
  const passed = stars >= SCHOOL_QUIZ_PASS_STARS;
  const progressPayload = body.progress;
  let mergedProgress: SchoolProgress | null = null;
  if (progressPayload && typeof progressPayload === "object" && !Array.isArray(progressPayload)) {
    const o = progressPayload as Record<string, unknown>;
    mergedProgress = {
      completedLessonIds: Array.isArray(o.completedLessonIds)
        ? o.completedLessonIds.filter((id): id is string => typeof id === "string")
        : [],
      lastLessonId: typeof o.lastLessonId === "string" ? o.lastLessonId : null,
      unlockedAt:
        o.unlockedAt && typeof o.unlockedAt === "object" && !Array.isArray(o.unlockedAt)
          ? (o.unlockedAt as Partial<Record<SchoolPhaseId, string>>)
          : { zendesk: new Date().toISOString() },
      quizStars:
        o.quizStars && typeof o.quizStars === "object" && !Array.isArray(o.quizStars)
          ? (o.quizStars as Partial<Record<SchoolPhaseId, number>>)
          : {},
    };
    const prevBest = mergedProgress.quizStars[phaseId] ?? 0;
    if (stars > prevBest) {
      mergedProgress.quizStars = { ...mergedProgress.quizStars, [phaseId]: stars };
    }
  }

  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { data: attempt, error: attemptErr } = await supabase
    .from("fixfy_school_quiz_attempts")
    .insert({
      profile_id: auth.user.id,
      phase_id: phaseId,
      stars,
      passed,
      answers,
      created_at: now,
    })
    .select("id, phase_id, stars, passed, answers, created_at")
    .single();

  if (attemptErr) {
    console.error("[api/school/quiz-attempt] insert failed:", attemptErr);
    return NextResponse.json({ error: "Could not save quiz attempt." }, { status: 500 });
  }

  const { data: existing } = await supabase
    .from("fixfy_school_progress")
    .select("*")
    .eq("profile_id", auth.user.id)
    .maybeSingle();

  if (!mergedProgress) {
    const base = existing
      ? rowToSchoolProgress(existing as SchoolProgressRow)
      : {
          completedLessonIds: [] as string[],
          lastLessonId: null,
          unlockedAt: { zendesk: now },
          quizStars: {} as Partial<Record<SchoolPhaseId, number>>,
        };
    const prevBest = base.quizStars[phaseId] ?? 0;
    mergedProgress = {
      ...base,
      quizStars: {
        ...base.quizStars,
        [phaseId]: Math.max(prevBest, stars),
      },
    };
  }

  const row = schoolProgressToRow(auth.user.id, mergedProgress);
  const certified = certifiedPhaseIds(mergedProgress);

  await supabase.from("fixfy_school_progress").upsert(
    { ...row, created_at: (existing as SchoolProgressRow | null)?.created_at ?? now },
    { onConflict: "profile_id" },
  );

  await supabase
    .from("profiles")
    .update({
      fixfy_school_xp: row.total_xp_earned,
      fixfy_school_certified_phases: certified,
      fixfy_school_last_activity_at: now,
      updated_at: now,
    })
    .eq("id", auth.user.id);

  return NextResponse.json({
    ok: true,
    attempt,
    progress: mergedProgress,
    profileSummary: { xp: row.total_xp_earned, certifiedPhases: certified },
  });
}
