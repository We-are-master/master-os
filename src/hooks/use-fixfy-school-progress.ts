"use client";

import { useCallback, useEffect, useState } from "react";
import type { SchoolPhaseId } from "@/lib/fixfy-school-curriculum";
import type { SchoolQuizAttemptAnswer } from "@/lib/fixfy-school-db";
import {
  getCachedSchoolProgress,
  fetchSchoolProgressFromServer,
  mergeSchoolProgress,
  persistSchoolProgressToServer,
  recordQuizAttemptOnServer,
  type SchoolQuizAttemptSummary,
} from "@/lib/fixfy-school-sync";
import {
  completeLesson as completeLessonLocal,
  readSchoolProgress,
  submitQuizResult as submitQuizLocal,
  setLastLesson as setLastLessonLocal,
  type SchoolProgress,
} from "@/lib/fixfy-school-progress";

export function useFixfySchoolProgress() {
  const [progress, setProgress] = useState<SchoolProgress>(readSchoolProgress);
  const [quizAttempts, setQuizAttempts] = useState<SchoolQuizAttemptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const local = getCachedSchoolProgress();
    const remote = await fetchSchoolProgressFromServer();
    if (remote) {
      const merged = mergeSchoolProgress(local, remote.progress);
      setProgress(merged);
      setQuizAttempts(remote.quizAttempts);
      void persistSchoolProgressToServer(merged);
    } else {
      setProgress(local);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const completeLesson = useCallback(async (lessonId: string) => {
    const next = completeLessonLocal(lessonId);
    setProgress(next);
    setSyncing(true);
    await persistSchoolProgressToServer(next);
    setSyncing(false);
    return next;
  }, []);

  const setLastLesson = useCallback(async (lessonId: string) => {
    const current = getCachedSchoolProgress();
    if (current.lastLessonId === lessonId) return;
    setLastLessonLocal(lessonId);
    const next = getCachedSchoolProgress();
    setProgress(next);
    void persistSchoolProgressToServer(next);
  }, []);

  const submitQuizResult = useCallback(
    async (
      phaseId: SchoolPhaseId,
      stars: number,
      answers: SchoolQuizAttemptAnswer[],
    ) => {
      const next = submitQuizLocal(phaseId, stars);
      setProgress(next);
      setSyncing(true);
      const saved =
        (await recordQuizAttemptOnServer({ phaseId, stars, answers, progress: next })) ?? next;
      setProgress(saved);
      const remote = await fetchSchoolProgressFromServer();
      if (remote) setQuizAttempts(remote.quizAttempts);
      setSyncing(false);
      return saved;
    },
    [],
  );

  return {
    progress,
    quizAttempts,
    loading,
    syncing,
    refresh,
    completeLesson,
    setLastLesson,
    submitQuizResult,
  };
}
