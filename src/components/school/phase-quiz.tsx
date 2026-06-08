"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, RotateCcw, Sparkles, Star, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SchoolPhase } from "@/lib/fixfy-school-curriculum";
import { SCHOOL_QUIZ_PASS_STARS, type SchoolQuizQuestion } from "@/lib/fixfy-school-quizzes";
import { getLocalizedPhase, getLocalizedQuiz } from "@/lib/fixfy-school-localized";
import { useFixfySchoolLocale } from "@/hooks/use-fixfy-school-locale";
import {
  getQuizStars,
  isPhaseQuizPassed,
  previousPhaseId,
  type SchoolProgress,
} from "@/lib/fixfy-school-progress";
import type { SchoolQuizAttemptAnswer } from "@/lib/fixfy-school-db";
import { useFixfySchoolProgress } from "@/hooks/use-fixfy-school-progress";

type Props = {
  phase: SchoolPhase;
  progress: SchoolProgress;
};

function scoreAnswers(questions: SchoolQuizQuestion[], answers: Record<string, number>): number {
  return questions.reduce((score, q) => {
    return answers[q.id] === q.correctIndex ? score + 1 : score;
  }, 0);
}

function StarRating({
  stars,
  max = SCHOOL_QUIZ_PASS_STARS,
  animate = false,
  size = "lg",
}: {
  stars: number;
  max?: number;
  animate?: boolean;
  size?: "md" | "lg";
}) {
  const iconSize = size === "lg" ? "h-10 w-10" : "h-6 w-6";
  return (
    <div className="flex items-center justify-center gap-2" role="img" aria-label={`${stars} of ${max} stars`}>
      {Array.from({ length: max }).map((_, i) => {
        const filled = i < stars;
        return (
          <Star
            key={i}
            className={cn(
              iconSize,
              "transition-all duration-500",
              filled
                ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                : "fill-transparent text-white/25",
              animate && filled && "scale-110 animate-[pulse_0.6s_ease-in-out]",
            )}
            style={animate && filled ? { animationDelay: `${i * 120}ms` } : undefined}
          />
        );
      })}
    </div>
  );
}

export function PhaseQuizCta({ phase, progress }: Props) {
  const stars = getQuizStars(progress, phase.id);
  const passed = isPhaseQuizPassed(progress, phase.id);

  return (
    <div
      className={cn(
        "rounded-2xl border p-5 sm:p-6 space-y-4",
        passed
          ? "border-emerald-300/60 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-[#0c0c12]"
          : "border-amber-300/50 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/25 dark:to-[#0c0c12]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
            Final challenge
          </p>
          <h2 className="text-lg font-bold text-text-primary mt-0.5 m-0">
            {passed ? "Phase certified!" : "Phase quiz — 5 questions"}
          </h2>
          <p className="text-sm text-text-secondary mt-1 m-0 leading-relaxed">
            {passed
              ? "You scored 5/5 stars. The next phase is unlocked."
              : "Study done? Prove it. You need 5/5 stars to unlock the next phase."}
          </p>
        </div>
        {passed ? (
          <Trophy className="h-8 w-8 text-amber-500 shrink-0" />
        ) : (
          <Sparkles className="h-8 w-8 text-amber-500 shrink-0" />
        )}
      </div>

      <StarRating stars={stars} animate={false} size="md" />

      <Link href={`/school/${phase.id}/quiz`}>
        <Button
          size="sm"
          className="w-full sm:w-auto"
          variant={passed ? "outline" : "primary"}
          icon={passed ? <RotateCcw className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
        >
          {passed ? "Retake quiz" : stars > 0 ? `Try again (${stars}/5)` : "Start quiz"}
        </Button>
      </Link>
    </div>
  );
}

function buildAttemptAnswers(
  questions: SchoolQuizQuestion[],
  answers: Record<string, number>,
): SchoolQuizAttemptAnswer[] {
  return questions.map((q) => {
    const selected = answers[q.id] ?? -1;
    return {
      question_id: q.id,
      selected_index: selected,
      correct_index: q.correctIndex,
      correct: selected === q.correctIndex,
    };
  });
}

export function PhaseQuiz({ phase, progress: initialProgress }: Props) {
  const router = useRouter();
  const { locale } = useFixfySchoolLocale();
  const questions = getLocalizedQuiz(phase.id, locale);
  const { progress, submitQuizResult } = useFixfySchoolProgress();
  const displayProgress = progress.completedLessonIds.length >= initialProgress.completedLessonIds.length
    ? progress
    : initialProgress;
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [resultStars, setResultStars] = useState(0);
  const [showExplanations, setShowExplanations] = useState(false);

  const bestStars = getQuizStars(displayProgress, phase.id);
  const passed = submitted ? resultStars >= SCHOOL_QUIZ_PASS_STARS : isPhaseQuizPassed(displayProgress, phase.id);

  const handleSubmit = useCallback(() => {
    const unanswered = questions.filter((q) => answers[q.id] === undefined);
    if (unanswered.length > 0) {
      toast.error("Answer all 5 questions before submitting.");
      return;
    }
    const stars = scoreAnswers(questions, answers);
    const attemptAnswers = buildAttemptAnswers(questions, answers);
    setResultStars(stars);
    setSubmitted(true);
    setShowExplanations(true);
    void submitQuizResult(phase.id, stars, attemptAnswers);

    if (stars >= SCHOOL_QUIZ_PASS_STARS) {
      toast.success("5/5 stars — phase certified!", {
        description: "Next phase unlocked. Great work!",
      });
    } else {
      toast.error(`${stars}/5 stars — keep studying and try again.`, {
        description: "You need a perfect score to pass.",
      });
    }
  }, [answers, phase.id, questions, submitQuizResult]);

  const handleRetry = () => {
    setAnswers({});
    setSubmitted(false);
    setResultStars(0);
    setShowExplanations(false);
  };

  const nextPhase = (() => {
    const phases = ["zendesk", "fixfy-os", "trade-portal"] as const;
    const idx = phases.indexOf(phase.id);
    if (idx < 0 || idx >= phases.length - 1) return null;
    return getLocalizedPhase(phases[idx + 1]!, locale);
  })();

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border-light bg-card p-6 sm:p-8 text-center space-y-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#E94A02] m-0">
          {phase.subtitle} · Final quiz
        </p>
        <h1 className="text-2xl font-bold text-text-primary m-0">{phase.title}</h1>
        <p className="text-sm text-text-secondary m-0 max-w-md mx-auto">
          5 questions · 1 star per correct answer · <strong className="text-text-primary">5/5 to pass</strong>
        </p>
        {bestStars > 0 && !submitted && (
          <p className="text-xs text-text-tertiary m-0">Best score: {bestStars}/5 stars</p>
        )}
      </div>

      {submitted && (
        <div
          className={cn(
            "rounded-2xl border p-6 sm:p-8 text-center space-y-4 transition-all",
            passed
              ? "border-emerald-400/50 bg-gradient-to-br from-emerald-50 via-amber-50/50 to-white dark:from-emerald-950/40 dark:via-amber-950/20 dark:to-[#0c0c12]"
              : "border-amber-300/40 bg-gradient-to-br from-amber-50/80 to-white dark:from-amber-950/30 dark:to-[#0c0c12]",
          )}
        >
          {passed ? (
            <>
              <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-emerald-500/15 mx-auto">
                <Trophy className="h-8 w-8 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-text-primary m-0">Phase certified!</h2>
              <p className="text-sm text-text-secondary m-0">
                Perfect score — you unlocked {nextPhase ? nextPhase.title : "full certification"}.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-text-primary m-0">Almost there!</h2>
              <p className="text-sm text-text-secondary m-0">
                You got {resultStars}/5. Review the explanations below and try again.
              </p>
            </>
          )}
          <StarRating stars={submitted ? resultStars : bestStars} animate={submitted} />
        </div>
      )}

      <div className="space-y-4">
        {questions.map((q, idx) => {
          const selected = answers[q.id];
          const isCorrect = submitted && selected === q.correctIndex;
          const isWrong = submitted && selected !== undefined && selected !== q.correctIndex;

          return (
            <div
              key={q.id}
              className={cn(
                "rounded-xl border p-4 sm:p-5 space-y-3 transition-colors",
                submitted && isCorrect && "border-emerald-300/60 bg-emerald-50/40 dark:bg-emerald-950/20",
                submitted && isWrong && "border-red-300/50 bg-red-50/30 dark:bg-red-950/15",
                !submitted && "border-border-light bg-card",
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    submitted && isCorrect && "bg-emerald-500 text-white",
                    submitted && isWrong && "bg-red-500 text-white",
                    !submitted && "bg-[#E94A02]/10 text-[#E94A02]",
                  )}
                >
                  {submitted && isCorrect ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                </span>
                <p className="text-sm font-semibold text-text-primary m-0 leading-relaxed">{q.prompt}</p>
              </div>

              <div className="space-y-2 pl-10">
                {q.options.map((opt, optIdx) => {
                  const chosen = selected === optIdx;
                  const correct = submitted && optIdx === q.correctIndex;
                  return (
                    <button
                      key={optIdx}
                      type="button"
                      disabled={submitted}
                      onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: optIdx }))}
                      className={cn(
                        "w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-all",
                        !submitted && chosen && "border-[#E94A02] bg-[#FFF4ED]/80 dark:bg-[#2a1508]/50",
                        !submitted && !chosen && "border-border-light hover:border-[#E94A02]/40 hover:bg-surface-hover/50",
                        submitted && correct && "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30 font-medium",
                        submitted && chosen && !correct && "border-red-400 bg-red-50/50 dark:bg-red-950/20",
                        submitted && !chosen && !correct && "opacity-60",
                      )}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>

              {showExplanations && submitted && (
                <p className="text-xs text-text-tertiary pl-10 m-0 leading-relaxed border-t border-border-light pt-3">
                  {q.explanation}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Link href={`/school/${phase.id}`}>
          <Button variant="outline" size="sm">
            Back to lessons
          </Button>
        </Link>

        <div className="flex flex-wrap gap-2">
          {submitted && !passed && (
            <Button variant="outline" size="sm" onClick={handleRetry} icon={<RotateCcw className="h-4 w-4" />}>
              Try again
            </Button>
          )}
          {submitted && passed && nextPhase && (
            <Button
              size="sm"
              onClick={() => router.push(`/school/${nextPhase.id}`)}
              icon={<ArrowRight className="h-4 w-4" />}
            >
              Next phase
            </Button>
          )}
          {!submitted && (
            <Button size="sm" onClick={handleSubmit} icon={<Sparkles className="h-4 w-4" />}>
              Submit answers
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function PhaseQuizLocked({ phaseId }: { phaseId: string }) {
  const { locale } = useFixfySchoolLocale();
  const prev = previousPhaseId(phaseId as "fixfy-os" | "zendesk" | "trade-portal");
  const prevPhase = prev ? getLocalizedPhase(prev, locale) : null;

  return (
    <div className="rounded-xl border border-dashed border-border-light bg-surface-hover/40 p-6 text-center space-y-2">
      <Star className="h-8 w-8 text-text-tertiary mx-auto" />
      <p className="text-sm font-medium text-text-secondary m-0">Quiz locked</p>
      <p className="text-xs text-text-tertiary m-0">
        Complete all lessons in this phase first.
        {prevPhase && (
          <>
            {" "}
            Previous phase ({prevPhase.title}) requires 5/5 on its quiz to unlock this phase.
          </>
        )}
      </p>
    </div>
  );
}
