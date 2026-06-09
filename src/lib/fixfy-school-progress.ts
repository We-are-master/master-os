"use client";

import {
  FIXFY_SCHOOL_ACHIEVEMENTS,
  FIXFY_SCHOOL_PHASES,
  getSchoolLesson,
  type SchoolPhaseId,
} from "@/lib/fixfy-school-curriculum";
import { SCHOOL_QUIZ_PASS_STARS } from "@/lib/fixfy-school-quizzes";

const STORAGE_KEY = "fixfy_school_progress_v2";

export type SchoolProgress = {
  completedLessonIds: string[];
  lastLessonId: string | null;
  unlockedAt: Partial<Record<SchoolPhaseId, string>>;
  /** Best quiz score per phase — 0 to 5 stars. */
  quizStars: Partial<Record<SchoolPhaseId, number>>;
};

const PHASE_ORDER: SchoolPhaseId[] = [...FIXFY_SCHOOL_PHASES]
  .sort((a, b) => a.order - b.order)
  .map((p) => p.id);

function emptyProgress(): SchoolProgress {
  return {
    completedLessonIds: [],
    lastLessonId: null,
    unlockedAt: { "fixfy-products": new Date().toISOString() },
    quizStars: {},
  };
}

function migrateV1(): SchoolProgress | null {
  try {
    const raw = localStorage.getItem("fixfy_school_progress_v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SchoolProgress>;
    return {
      completedLessonIds: Array.isArray(parsed.completedLessonIds) ? parsed.completedLessonIds : [],
      lastLessonId: typeof parsed.lastLessonId === "string" ? parsed.lastLessonId : null,
      unlockedAt: { "fixfy-products": new Date().toISOString(), ...(parsed.unlockedAt ?? {}) },
      quizStars: {},
    };
  } catch {
    return null;
  }
}

export function readSchoolProgress(): SchoolProgress {
  if (typeof window === "undefined") return emptyProgress();
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const migrated = migrateV1();
      if (migrated) {
        writeSchoolProgress(migrated);
        return migrated;
      }
      return emptyProgress();
    }
    const parsed = JSON.parse(raw) as Partial<SchoolProgress>;
    return {
      completedLessonIds: Array.isArray(parsed.completedLessonIds) ? parsed.completedLessonIds : [],
      lastLessonId: typeof parsed.lastLessonId === "string" ? parsed.lastLessonId : null,
      unlockedAt: { "fixfy-products": new Date().toISOString(), ...(parsed.unlockedAt ?? {}) },
      quizStars: parsed.quizStars ?? {},
    };
  } catch {
    return emptyProgress();
  }
}

export function writeSchoolProgress(progress: SchoolProgress): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export function isLessonComplete(progress: SchoolProgress, lessonId: string): boolean {
  return progress.completedLessonIds.includes(lessonId);
}

export function phaseProgress(progress: SchoolProgress, phaseId: SchoolPhaseId) {
  const phase = FIXFY_SCHOOL_PHASES.find((p) => p.id === phaseId);
  if (!phase) return { completed: 0, total: 0, percent: 0, xpEarned: 0, xpTotal: 0 };
  const total = phase.lessons.length;
  const completed = phase.lessons.filter((l) => isLessonComplete(progress, l.id)).length;
  const xpEarned = phase.lessons
    .filter((l) => isLessonComplete(progress, l.id))
    .reduce((s, l) => s + l.xp, 0);
  const xpTotal = phase.lessons.reduce((s, l) => s + l.xp, 0);
  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    xpEarned,
    xpTotal,
  };
}

export function totalEarnedXp(progress: SchoolProgress): number {
  return FIXFY_SCHOOL_PHASES.flatMap((p) => p.lessons)
    .filter((l) => isLessonComplete(progress, l.id))
    .reduce((s, l) => s + l.xp, 0);
}

export function isPhaseLessonsComplete(progress: SchoolProgress, phaseId: SchoolPhaseId): boolean {
  const { completed, total } = phaseProgress(progress, phaseId);
  return total > 0 && completed === total;
}

export function getQuizStars(progress: SchoolProgress, phaseId: SchoolPhaseId): number {
  return progress.quizStars[phaseId] ?? 0;
}

export function isPhaseQuizPassed(progress: SchoolProgress, phaseId: SchoolPhaseId): boolean {
  return getQuizStars(progress, phaseId) >= SCHOOL_QUIZ_PASS_STARS;
}

/** Lessons complete + quiz 5/5 = phase certified. */
export function isPhaseComplete(progress: SchoolProgress, phaseId: SchoolPhaseId): boolean {
  return isPhaseLessonsComplete(progress, phaseId) && isPhaseQuizPassed(progress, phaseId);
}

export function previousPhaseId(phaseId: SchoolPhaseId): SchoolPhaseId | null {
  const idx = PHASE_ORDER.indexOf(phaseId);
  if (idx <= 0) return null;
  return PHASE_ORDER[idx - 1] ?? null;
}

/** First phase (Foundation) always open. Next phases need previous quiz 5/5 stars. */
export function isPhaseUnlocked(progress: SchoolProgress, phaseId: SchoolPhaseId): boolean {
  const prev = previousPhaseId(phaseId);
  if (!prev) return true;
  return isPhaseQuizPassed(progress, prev);
}

export function isQuizAvailable(progress: SchoolProgress, phaseId: SchoolPhaseId): boolean {
  return isPhaseLessonsComplete(progress, phaseId) && isPhaseUnlocked(progress, phaseId);
}

export function isLessonUnlocked(progress: SchoolProgress, lessonId: string): boolean {
  const lesson = getSchoolLesson(lessonId);
  if (!lesson) return false;
  if (!isPhaseUnlocked(progress, lesson.phaseId)) return false;
  const phase = FIXFY_SCHOOL_PHASES.find((p) => p.id === lesson.phaseId);
  if (!phase) return false;
  const sorted = [...phase.lessons].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((l) => l.id === lessonId);
  if (idx <= 0) return true;
  return isLessonComplete(progress, sorted[idx - 1]!.id);
}

export function completeLesson(lessonId: string): SchoolProgress {
  const progress = readSchoolProgress();
  if (!progress.completedLessonIds.includes(lessonId)) {
    progress.completedLessonIds = [...progress.completedLessonIds, lessonId];
  }
  progress.lastLessonId = lessonId;
  writeSchoolProgress(progress);
  return progress;
}

export function submitQuizResult(phaseId: SchoolPhaseId, stars: number): SchoolProgress {
  const progress = readSchoolProgress();
  const prev = progress.quizStars[phaseId] ?? 0;
  if (stars > prev) {
    progress.quizStars = { ...progress.quizStars, [phaseId]: stars };
  }
  writeSchoolProgress(progress);
  return progress;
}

export function setLastLesson(lessonId: string): void {
  const progress = readSchoolProgress();
  if (progress.lastLessonId === lessonId) return;
  progress.lastLessonId = lessonId;
  writeSchoolProgress(progress);
}

export function nextIncompleteLesson(progress: SchoolProgress): string | null {
  for (const phaseId of PHASE_ORDER) {
    const phase = FIXFY_SCHOOL_PHASES.find((p) => p.id === phaseId);
    if (!phase || !isPhaseUnlocked(progress, phase.id)) continue;
    const sorted = [...phase.lessons].sort((a, b) => a.order - b.order);
    for (const lesson of sorted) {
      if (!isLessonComplete(progress, lesson.id) && isLessonUnlocked(progress, lesson.id)) {
        return lesson.id;
      }
    }
  }
  return null;
}

export function earnedAchievements(progress: SchoolProgress) {
  const completedCount = progress.completedLessonIds.length;
  return FIXFY_SCHOOL_ACHIEVEMENTS.filter((a) => {
    return a.requires.every((req) => {
      if (req.type === "lesson" && req.id === "any") return completedCount >= 1;
      if (req.type === "lesson") return isLessonComplete(progress, req.id);
      if (req.type === "phase") return isPhaseComplete(progress, req.id as SchoolPhaseId);
      return false;
    });
  });
}
