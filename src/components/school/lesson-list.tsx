"use client";

import Link from "next/link";
import { CheckCircle2, Lock, FileText, FileType, Clock, Zap, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SchoolLesson, SchoolPhase } from "@/lib/fixfy-school-curriculum";
import {
  isLessonComplete,
  isLessonUnlocked,
  type SchoolProgress,
} from "@/lib/fixfy-school-progress";

type Props = {
  phase: SchoolPhase;
  progress: SchoolProgress;
};

export function LessonList({ phase, progress }: Props) {
  const sorted = [...phase.lessons].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-2">
      {sorted.map((lesson, index) => (
        <LessonRow
          key={lesson.id}
          lesson={lesson}
          index={index + 1}
          progress={progress}
        />
      ))}
    </div>
  );
}

function LessonRow({
  lesson,
  index,
  progress,
}: {
  lesson: SchoolLesson;
  index: number;
  progress: SchoolProgress;
}) {
  const done = isLessonComplete(progress, lesson.id);
  const unlocked = isLessonUnlocked(progress, lesson.id);
  const FormatIcon = lesson.format === "pdf" ? FileType : FileText;

  const content = (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border px-4 py-3.5 transition-all",
        done && "border-emerald-200/80 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20",
        unlocked && !done && "border-border-light bg-card hover:border-[#E94A02]/35 hover:shadow-sm cursor-pointer",
        !unlocked && "border-dashed border-border-light bg-surface-hover/30 opacity-60",
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
          done
            ? "bg-emerald-500 text-white"
            : unlocked
              ? "bg-[#E94A02]/10 text-[#E94A02]"
              : "bg-surface-hover text-text-tertiary",
        )}
      >
        {done ? <CheckCircle2 className="h-5 w-5" /> : unlocked ? index : <Lock className="h-4 w-4" />}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary truncate">{lesson.title}</p>
        <p className="text-xs text-text-tertiary mt-0.5 line-clamp-1">{lesson.description}</p>
        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] text-text-tertiary">
          <span className="inline-flex items-center gap-1">
            <FormatIcon className="h-3 w-3" />
            {lesson.format.toUpperCase()}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {lesson.durationMin} min
          </span>
          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
            <Zap className="h-3 w-3" />
            +{lesson.xp} XP
          </span>
        </div>
      </div>

      {unlocked && (
        <PlayCircle
          className={cn("h-5 w-5 shrink-0", done ? "text-emerald-600" : "text-[#E94A02]")}
          aria-hidden
        />
      )}
    </div>
  );

  if (!unlocked) return <div key={lesson.id}>{content}</div>;

  return (
    <Link key={lesson.id} href={`/school/lesson/${lesson.id}`}>
      {content}
    </Link>
  );
}
