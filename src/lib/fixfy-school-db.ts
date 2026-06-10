import {
  FIXFY_SCHOOL_PHASES,
  type SchoolPhaseId,
} from "@/lib/fixfy-school-curriculum";
import { isPhaseQuizScorePassing } from "@/lib/fixfy-school-quizzes";
import type { SchoolProgress } from "@/lib/fixfy-school-progress";
import { isLessonComplete, totalEarnedXp } from "@/lib/fixfy-school-progress";

export type SchoolQuizAttemptAnswer = {
  question_id: string;
  selected_index: number;
  correct_index: number;
  correct: boolean;
};

export type SchoolQuizAttemptRow = {
  id: string;
  profile_id: string;
  phase_id: SchoolPhaseId;
  stars: number;
  passed: boolean;
  answers: SchoolQuizAttemptAnswer[];
  created_at: string;
};

export type SchoolProgressRow = {
  profile_id: string;
  completed_lesson_ids: string[];
  last_lesson_id: string | null;
  unlocked_at: Partial<Record<SchoolPhaseId, string>>;
  quiz_stars: Partial<Record<SchoolPhaseId, number>>;
  total_xp_earned: number;
  created_at: string;
  updated_at: string;
};

const PHASE_IDS = new Set<SchoolPhaseId>(FIXFY_SCHOOL_PHASES.map((p) => p.id));

export function emptySchoolProgressRow(profileId: string): SchoolProgressRow {
  const now = new Date().toISOString();
  return {
    profile_id: profileId,
    completed_lesson_ids: [],
    last_lesson_id: null,
    unlocked_at: { "fixfy-products": now },
    quiz_stars: {},
    total_xp_earned: 0,
    created_at: now,
    updated_at: now,
  };
}

export function rowToSchoolProgress(row: SchoolProgressRow): SchoolProgress {
  const unlockedAt = { "fixfy-products": new Date().toISOString(), ...(row.unlocked_at ?? {}) };
  if (!unlockedAt["fixfy-products"]) unlockedAt["fixfy-products"] = new Date().toISOString();
  return {
    completedLessonIds: Array.isArray(row.completed_lesson_ids) ? row.completed_lesson_ids : [],
    lastLessonId: row.last_lesson_id,
    unlockedAt,
    quizStars: row.quiz_stars ?? {},
  };
}

export function schoolProgressToRow(profileId: string, progress: SchoolProgress): Omit<SchoolProgressRow, "created_at"> & {
  created_at?: string;
} {
  const xp = totalEarnedXp(progress);
  return {
    profile_id: profileId,
    completed_lesson_ids: progress.completedLessonIds,
    last_lesson_id: progress.lastLessonId,
    unlocked_at: progress.unlockedAt,
    quiz_stars: progress.quizStars,
    total_xp_earned: xp,
    updated_at: new Date().toISOString(),
  };
}

export function certifiedPhaseIds(progress: SchoolProgress): SchoolPhaseId[] {
  return FIXFY_SCHOOL_PHASES.filter((p) => {
    const stars = progress.quizStars[p.id] ?? 0;
    const lessonsDone = p.lessons.every((l) => isLessonComplete(progress, l.id));
    return lessonsDone && isPhaseQuizScorePassing(p.id, stars);
  }).map((p) => p.id);
}

export function isValidPhaseId(id: string): id is SchoolPhaseId {
  return PHASE_IDS.has(id as SchoolPhaseId);
}

export function parseQuizAnswers(raw: unknown): SchoolQuizAttemptAnswer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const question_id = typeof o.question_id === "string" ? o.question_id : "";
      const selected_index = Number(o.selected_index);
      const correct_index = Number(o.correct_index);
      if (!question_id || !Number.isInteger(selected_index) || !Number.isInteger(correct_index)) {
        return null;
      }
      return {
        question_id,
        selected_index,
        correct_index,
        correct: Boolean(o.correct),
      };
    })
    .filter((x): x is SchoolQuizAttemptAnswer => x != null);
}
