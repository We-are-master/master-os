"use client";

import Link from "next/link";
import { Lock, CheckCircle2, ChevronRight, Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SchoolPhase } from "@/lib/fixfy-school-curriculum";
import {
  getQuizStars,
  isPhaseComplete,
  isPhaseLessonsComplete,
  isPhaseQuizPassed,
  isPhaseUnlocked,
  phaseProgress,
  previousPhaseId,
  type SchoolProgress,
} from "@/lib/fixfy-school-progress";
import { SCHOOL_QUIZ_PASS_STARS } from "@/lib/fixfy-school-quizzes";
import { getLocalizedPhase } from "@/lib/fixfy-school-localized";
import { useFixfySchoolLocale } from "@/hooks/use-fixfy-school-locale";

const ACCENT: Record<SchoolPhase["accent"], { ring: string; bg: string; text: string; bar: string }> = {
  violet: {
    ring: "ring-violet-500/30",
    bg: "bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/40 dark:to-[#0c0c12]",
    text: "text-violet-700 dark:text-violet-300",
    bar: "bg-gradient-to-r from-violet-500 to-purple-600",
  },
  coral: {
    ring: "ring-[#E94A02]/30",
    bg: "bg-gradient-to-br from-[#FFF4ED] to-white dark:from-[#2a1508] dark:to-[#1a1008]",
    text: "text-[#C73A00]",
    bar: "bg-gradient-to-r from-[#FF6B2B] to-[#E94A02]",
  },
  blue: {
    ring: "ring-blue-500/30",
    bg: "bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/40 dark:to-[#0c0c12]",
    text: "text-blue-700 dark:text-blue-300",
    bar: "bg-gradient-to-r from-blue-500 to-indigo-600",
  },
  emerald: {
    ring: "ring-emerald-500/30",
    bg: "bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-[#0c0c12]",
    text: "text-emerald-700 dark:text-emerald-300",
    bar: "bg-gradient-to-r from-emerald-500 to-teal-600",
  },
};

type Props = {
  phase: SchoolPhase;
  progress: SchoolProgress;
};

export function PhaseCard({ phase, progress }: Props) {
  const { locale } = useFixfySchoolLocale();
  const unlocked = isPhaseUnlocked(progress, phase.id);
  const complete = isPhaseComplete(progress, phase.id);
  const lessonsDone = isPhaseLessonsComplete(progress, phase.id);
  const quizPassed = isPhaseQuizPassed(progress, phase.id);
  const quizStars = getQuizStars(progress, phase.id);
  const stats = phaseProgress(progress, phase.id);
  const accent = ACCENT[phase.accent] ?? ACCENT.coral;
  const prevPhase = previousPhaseId(phase.id);
  const prevTitle = prevPhase ? getLocalizedPhase(prevPhase, locale)?.title : null;

  const inner = (
    <div
      className={cn(
        "relative rounded-2xl border p-5 sm:p-6 transition-all duration-300 h-full flex flex-col",
        unlocked
          ? cn("border-border-light hover:border-[#E94A02]/40 hover:shadow-md cursor-pointer", accent.bg)
          : "border-dashed border-border-light bg-surface-hover/40 opacity-75",
        complete && unlocked && "ring-2 ring-emerald-500/25",
      )}
    >
      {!unlocked && (
        <div className="absolute inset-0 rounded-2xl bg-surface-secondary/40 backdrop-blur-[1px] flex items-center justify-center z-10">
          <div className="text-center px-4">
            <Lock className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
            <p className="text-sm font-medium text-text-secondary">Locked</p>
            <p className="text-xs text-text-tertiary mt-1">
              Score {SCHOOL_QUIZ_PASS_STARS}/{SCHOOL_QUIZ_PASS_STARS} on{prevTitle ? ` ${prevTitle}` : " the previous phase"} quiz
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn("text-[11px] font-bold uppercase tracking-wider", accent.text)}>
            {phase.subtitle}
          </p>
          <h2 className="text-lg font-bold text-text-primary mt-0.5">{phase.title}</h2>
        </div>
        {complete ? (
          <CheckCircle2 className="h-6 w-6 text-emerald-500 shrink-0" aria-label="Phase complete" />
        ) : unlocked ? (
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums",
              "bg-white/80 dark:bg-white/10 shadow-sm ring-2",
              accent.ring,
              accent.text,
            )}
          >
            {stats.percent}%
          </span>
        ) : null}
      </div>

      <p className="text-sm text-text-secondary mt-3 flex-1 leading-relaxed">{phase.description}</p>

      <div className="mt-4 space-y-2">
        <div className="flex justify-between text-[11px] text-text-tertiary">
          <span>
            {stats.completed}/{stats.total} lessons
          </span>
          <span className="tabular-nums">
            {stats.xpEarned}/{stats.xpTotal} XP
          </span>
        </div>
        <div className="h-2 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", accent.bar)}
            style={{ width: `${stats.percent}%` }}
          />
        </div>
        {unlocked && lessonsDone && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-tertiary">Quiz stars</span>
            <span className="inline-flex items-center gap-0.5">
              {Array.from({ length: SCHOOL_QUIZ_PASS_STARS }).map((_, i) => (
                <Star
                  key={i}
                  className={cn(
                    "h-3.5 w-3.5",
                    i < quizStars ? "fill-amber-400 text-amber-400" : "text-text-tertiary/40",
                  )}
                />
              ))}
              {!quizPassed && (
                <span className="text-amber-700 dark:text-amber-400 font-medium ml-1">5/5 to pass</span>
              )}
            </span>
          </div>
        )}
      </div>

      {unlocked && (
        <div className="mt-4 flex items-center justify-between text-sm font-semibold text-[#E94A02]">
          <span className="inline-flex items-center gap-1">
            {complete ? (
              <>
                <Sparkles className="h-4 w-4" />
                Review phase
              </>
            ) : (
              "Continue learning"
            )}
          </span>
          <ChevronRight className="h-4 w-4" />
        </div>
      )}
    </div>
  );

  if (!unlocked) return inner;

  return (
    <Link href={`/school/${phase.id}`} className="block h-full">
      {inner}
    </Link>
  );
}
