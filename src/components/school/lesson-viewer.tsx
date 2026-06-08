"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, ExternalLink, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FIXFY_SCHOOL_PHASES, type SchoolLesson } from "@/lib/fixfy-school-curriculum";
import { isLessonComplete, isLessonUnlocked, type SchoolProgress } from "@/lib/fixfy-school-progress";
import { useFixfySchoolProgress } from "@/hooks/use-fixfy-school-progress";
import { useFixfySchoolLocale } from "@/hooks/use-fixfy-school-locale";
import { getLocalizedLesson, getLocalizedPhase } from "@/lib/fixfy-school-localized";
import { SchoolLanguageSwitcher } from "@/components/school/school-language-switcher";

type Props = {
  lessonId: string;
};

export function LessonViewer({ lessonId }: Props) {
  const router = useRouter();
  const { locale } = useFixfySchoolLocale();
  const lesson = getLocalizedLesson(lessonId, locale);
  const { progress, completeLesson, setLastLesson } = useFixfySchoolProgress();
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (!lesson || progress.lastLessonId === lesson.id) return;
    if (isLessonUnlocked(progress, lesson.id)) {
      void setLastLesson(lesson.id);
    }
  }, [lesson?.id, progress.lastLessonId, setLastLesson]);

  const handleComplete = useCallback(() => {
    if (!lesson) return;
    setCompleting(true);
    void completeLesson(lesson.id).then((next) => {
      toast.success(`+${lesson.xp} XP — lesson complete!`, {
        description: "Keep going to unlock the next module.",
      });
      setCompleting(false);

      const phase = getLocalizedPhase(lesson.phaseId, locale);
      if (!phase) return;
      const sorted = [...phase.lessons].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((l) => l.id === lesson.id);
      const nextLesson = sorted[idx + 1];
      const allDone = sorted.every((l) => next.completedLessonIds.includes(l.id));
      if (allDone) {
        toast.info("All lessons done — take the phase quiz!", {
          description: "Score 5/5 stars to unlock the next phase.",
        });
        setTimeout(() => router.push(`/school/${lesson.phaseId}/quiz`), 1500);
      } else if (nextLesson && isLessonUnlocked(next, nextLesson.id)) {
        setTimeout(() => router.push(`/school/lesson/${nextLesson.id}`), 1200);
      }
    });
  }, [lesson, locale, router, completeLesson]);

  if (!lesson) {
    return (
      <div className="text-center py-16">
        <p className="text-text-secondary">Lesson not found.</p>
        <Link href="/school" className="text-[#E94A02] text-sm font-medium mt-2 inline-block">
          Back to Fixfy School
        </Link>
      </div>
    );
  }

  if (!isLessonUnlocked(progress, lesson.id)) {
    return (
      <div className="text-center py-16 space-y-3">
        <p className="text-text-secondary">This lesson is locked. Complete the previous lesson first.</p>
        <Link href={`/school/${lesson.phaseId}`}>
          <Button variant="outline" size="sm">
            Back to phase
          </Button>
        </Link>
      </div>
    );
  }

  const done = isLessonComplete(progress, lesson.id);
  const phase = getLocalizedPhase(lesson.phaseId, locale);

  return (
    <div className="flex flex-col min-h-0 flex-1 gap-4">
      <div className="flex justify-end">
        <SchoolLanguageSwitcher variant="inline" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/school/${lesson.phaseId}`}
            className="inline-flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary transition-colors shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
            {phase?.title ?? "Phase"}
          </Link>
          <span className="text-border-light hidden sm:inline">|</span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-text-primary truncate m-0">{lesson.title}</h1>
            <p className="text-xs text-text-tertiary m-0">{lesson.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200">
            <Zap className="h-3.5 w-3.5" />
            +{lesson.xp} XP
          </span>
          {lesson.format === "pdf" && (
            <a href={lesson.assetPath} download target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />}>
                Download PDF
              </Button>
            </a>
          )}
          {!done ? (
            <Button
              size="sm"
              onClick={handleComplete}
              disabled={completing}
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            >
              Mark complete
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              Completed
            </span>
          )}
        </div>
      </div>

      <LessonContent lesson={lesson} />
    </div>
  );
}

function LessonContent({ lesson }: { lesson: SchoolLesson }) {
  if (lesson.format === "pdf") {
    return (
      <div className="flex-1 min-h-[60vh] rounded-xl border border-border-light overflow-hidden bg-surface-hover/30">
        <iframe
          title={lesson.title}
          src={lesson.assetPath}
          className="w-full h-full min-h-[60vh]"
        />
        <p className="text-center text-xs text-text-tertiary py-3 px-4">
          PDF not showing?{" "}
          <a
            href={lesson.assetPath}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#E94A02] font-medium inline-flex items-center gap-1"
          >
            Open in new tab
            <ExternalLink className="h-3 w-3" />
          </a>
          {" "}— drop your file at{" "}
          <code className="text-[10px] bg-surface-hover px-1 rounded">public{lesson.assetPath}</code>
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-[70vh] rounded-xl border border-border-light overflow-hidden bg-white dark:bg-[#0c0c12] shadow-sm">
      <iframe
        title={lesson.title}
        src={lesson.assetPath}
        className="w-full h-full min-h-[70vh] border-0"
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
      />
    </div>
  );
}

export function overallSchoolPercent(progress: SchoolProgress): number {
  const all = FIXFY_SCHOOL_PHASES.flatMap((p) => p.lessons);
  if (all.length === 0) return 0;
  const done = all.filter((l) => isLessonComplete(progress, l.id)).length;
  return Math.round((done / all.length) * 100);
}
