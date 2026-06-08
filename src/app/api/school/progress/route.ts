import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import {
  certifiedPhaseIds,
  emptySchoolProgressRow,
  rowToSchoolProgress,
  schoolProgressToRow,
  type SchoolProgressRow,
} from "@/lib/fixfy-school-db";
import type { SchoolProgress } from "@/lib/fixfy-school-progress";
import type { SchoolPhaseId } from "@/lib/fixfy-school-curriculum";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseProgressBody(body: unknown): SchoolProgress | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const completedLessonIds = Array.isArray(o.completedLessonIds)
    ? o.completedLessonIds.filter((id): id is string => typeof id === "string")
    : [];
  const lastLessonId = typeof o.lastLessonId === "string" ? o.lastLessonId : null;
  const unlockedAt =
    o.unlockedAt && typeof o.unlockedAt === "object" && !Array.isArray(o.unlockedAt)
      ? (o.unlockedAt as Partial<Record<SchoolPhaseId, string>>)
      : { zendesk: new Date().toISOString() };
  const quizStars =
    o.quizStars && typeof o.quizStars === "object" && !Array.isArray(o.quizStars)
      ? (o.quizStars as Partial<Record<SchoolPhaseId, number>>)
      : {};
  return { completedLessonIds, lastLessonId, unlockedAt, quizStars };
}

/** GET /api/school/progress — load current user's school state from DB. */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("fixfy_school_progress")
    .select("*")
    .eq("profile_id", auth.user.id)
    .maybeSingle();

  if (error) {
    console.error("[api/school/progress] GET failed:", error);
    return NextResponse.json({ error: "Could not load progress." }, { status: 500 });
  }

  const row = (data as SchoolProgressRow | null) ?? emptySchoolProgressRow(auth.user.id);
  const progress = rowToSchoolProgress(row);

  const { data: attempts } = await supabase
    .from("fixfy_school_quiz_attempts")
    .select("id, phase_id, stars, passed, answers, created_at")
    .eq("profile_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    progress,
    quizAttempts: attempts ?? [],
    profileSummary: {
      xp: row.total_xp_earned,
      certifiedPhases: certifiedPhaseIds(progress),
    },
  });
}

/** PUT /api/school/progress — upsert lesson/quiz progress + sync profile summary. */
export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const progress = parseProgressBody(body);
  if (!progress) {
    return NextResponse.json({ error: "Invalid progress payload." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const row = schoolProgressToRow(auth.user.id, progress);
  const certified = certifiedPhaseIds(progress);
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("fixfy_school_progress")
    .select("created_at")
    .eq("profile_id", auth.user.id)
    .maybeSingle();

  const { error: upsertErr } = await supabase.from("fixfy_school_progress").upsert(
    {
      ...row,
      created_at: (existing as { created_at?: string } | null)?.created_at ?? now,
    },
    { onConflict: "profile_id" },
  );

  if (upsertErr) {
    console.error("[api/school/progress] upsert failed:", upsertErr);
    return NextResponse.json({ error: "Could not save progress." }, { status: 500 });
  }

  const { error: profileErr } = await supabase
    .from("profiles")
    .update({
      fixfy_school_xp: row.total_xp_earned,
      fixfy_school_certified_phases: certified,
      fixfy_school_last_activity_at: now,
      updated_at: now,
    })
    .eq("id", auth.user.id);

  if (profileErr) {
    console.error("[api/school/progress] profile sync failed:", profileErr);
  }

  return NextResponse.json({
    ok: true,
    progress,
    profileSummary: { xp: row.total_xp_earned, certifiedPhases: certified },
  });
}
