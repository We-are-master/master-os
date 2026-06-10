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
import { recordSchoolQuizAttemptAdmin } from "@/lib/fixfy-school-record-quiz-attempt";
import {
  getPhaseQuizQuestionCount,
  isPhaseQuizScorePassing,
} from "@/lib/fixfy-school-quizzes";
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
  const maxScore = getPhaseQuizQuestionCount(phaseId);
  if (!Number.isInteger(stars) || stars < 0 || stars > maxScore) {
    return NextResponse.json({ error: `Invalid score (0-${maxScore}).` }, { status: 400 });
  }

  const answers = parseQuizAnswers(body.answers);
  const passed = isPhaseQuizScorePassing(phaseId, stars);
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

  try {
    const { attemptId } = await recordSchoolQuizAttemptAdmin(supabase, {
      profileId: auth.user.id,
      phaseId,
      stars,
      passed,
      answers,
      progress: mergedProgress,
      totalXpEarned: row.total_xp_earned,
      certifiedPhases: certified,
    });

    const { data: attempt } = await supabase
      .from("fixfy_school_quiz_attempts")
      .select("id, phase_id, stars, passed, answers, created_at")
      .eq("id", attemptId)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      attempt: attempt ?? {
        id: attemptId,
        phase_id: phaseId,
        stars,
        passed,
        answers,
        created_at: now,
      },
      progress: mergedProgress,
      profileSummary: { xp: row.total_xp_earned, certifiedPhases: certified },
    });
  } catch (err) {
    console.error("[api/school/quiz-attempt] save failed:", err);
    return NextResponse.json({ error: "Could not save quiz attempt." }, { status: 500 });
  }
}
