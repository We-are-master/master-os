"use client";

import type { SchoolPhaseId } from "@/lib/fixfy-school-curriculum";
import type { SchoolQuizAttemptAnswer } from "@/lib/fixfy-school-db";
import {
  readSchoolProgress,
  writeSchoolProgress,
  type SchoolProgress,
} from "@/lib/fixfy-school-progress";

export type SchoolQuizAttemptSummary = {
  id: string;
  phase_id: string;
  stars: number;
  passed: boolean;
  answers: SchoolQuizAttemptAnswer[];
  created_at: string;
};

/** Load progress from API; fall back to localStorage on failure. */
export async function fetchSchoolProgressFromServer(): Promise<{
  progress: SchoolProgress;
  quizAttempts: SchoolQuizAttemptSummary[];
} | null> {
  try {
    const res = await fetch("/api/school/progress", { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      progress: SchoolProgress;
      quizAttempts?: SchoolQuizAttemptSummary[];
    };
    if (!data.progress) return null;
    writeSchoolProgress(data.progress);
    return {
      progress: data.progress,
      quizAttempts: data.quizAttempts ?? [],
    };
  } catch {
    return null;
  }
}

export async function persistSchoolProgressToServer(progress: SchoolProgress): Promise<boolean> {
  writeSchoolProgress(progress);
  try {
    const res = await fetch("/api/school/progress", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(progress),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function recordQuizAttemptOnServer(options: {
  phaseId: SchoolPhaseId;
  stars: number;
  answers: SchoolQuizAttemptAnswer[];
  progress: SchoolProgress;
}): Promise<SchoolProgress | null> {
  writeSchoolProgress(options.progress);
  try {
    const res = await fetch("/api/school/quiz-attempt", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phaseId: options.phaseId,
        stars: options.stars,
        answers: options.answers,
        progress: options.progress,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { progress?: SchoolProgress };
    if (data.progress) {
      writeSchoolProgress(data.progress);
      return data.progress;
    }
    return options.progress;
  } catch {
    return null;
  }
}

/** Merge server state over local on first load. */
export function mergeSchoolProgress(local: SchoolProgress, remote: SchoolProgress): SchoolProgress {
  const completedSet = new Set([...local.completedLessonIds, ...remote.completedLessonIds]);
  const quizStars = { ...local.quizStars };
  for (const [phase, stars] of Object.entries(remote.quizStars)) {
    const id = phase as SchoolPhaseId;
    quizStars[id] = Math.max(quizStars[id] ?? 0, stars ?? 0);
  }
  return {
    completedLessonIds: [...completedSet],
    lastLessonId: remote.lastLessonId ?? local.lastLessonId,
    unlockedAt: { ...local.unlockedAt, ...remote.unlockedAt },
    quizStars,
  };
}

export function getCachedSchoolProgress(): SchoolProgress {
  return readSchoolProgress();
}
