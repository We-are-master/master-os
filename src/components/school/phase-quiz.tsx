"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Sparkles,
  Star,
  Trophy,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SchoolPhase } from "@/lib/fixfy-school-curriculum";
import { FIXFY_SCHOOL_PHASES } from "@/lib/fixfy-school-curriculum";
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

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

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
                : "fill-transparent text-text-tertiary/30",
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

function QuestionReviewCard({
  q,
  idx,
  selected,
  submitted,
  showExplanation,
}: {
  q: SchoolQuizQuestion;
  idx: number;
  selected: number | undefined;
  submitted: boolean;
  showExplanation: boolean;
}) {
  const isCorrect = submitted && selected === q.correctIndex;
  const isWrong = submitted && selected !== undefined && selected !== q.correctIndex;

  return (
    <div
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
          {submitted && isCorrect ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : submitted && isWrong ? (
            <XCircle className="h-4 w-4" />
          ) : (
            idx + 1
          )}
        </span>
        <p className="text-sm font-semibold text-text-primary m-0 leading-relaxed">{q.prompt}</p>
      </div>

      <div className="space-y-2">
        {q.options.map((opt, optIdx) => {
          const chosen = selected === optIdx;
          const correct = submitted && optIdx === q.correctIndex;
          return (
            <div
              key={optIdx}
              className={cn(
                "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm",
                !submitted && chosen && "border-[#E94A02] bg-[#FFF4ED]/80 dark:bg-[#2a1508]/50",
                !submitted && !chosen && "border-border-light",
                submitted && correct && "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30 font-medium",
                submitted && chosen && !correct && "border-red-400 bg-red-50/50 dark:bg-red-950/20",
                submitted && !chosen && !correct && "opacity-60 border-border-light",
              )}
            >
              <span className="font-bold text-text-tertiary shrink-0 w-4">{OPTION_LETTERS[optIdx] ?? "?"}</span>
              <span className="flex-1">{opt}</span>
            </div>
          );
        })}
      </div>

      {showExplanation && submitted && (
        <p className="text-xs text-text-tertiary m-0 leading-relaxed border-t border-border-light pt-3">
          {q.explanation}
        </p>
      )}
    </div>
  );
}

export function PhaseQuiz({ phase, progress: initialProgress }: Props) {
  const router = useRouter();
  const { locale } = useFixfySchoolLocale();
  const questions = getLocalizedQuiz(phase.id, locale);
  const total = questions.length;
  const passRequired = SCHOOL_QUIZ_PASS_STARS;

  const { progress, submitQuizResult } = useFixfySchoolProgress();
  const displayProgress = progress.completedLessonIds.length >= initialProgress.completedLessonIds.length
    ? progress
    : initialProgress;

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [resultStars, setResultStars] = useState(0);
  const [showReview, setShowReview] = useState(false);

  const bestStars = getQuizStars(displayProgress, phase.id);
  const answeredCount = useMemo(
    () => questions.filter((q) => answers[q.id] !== undefined).length,
    [answers, questions],
  );
  const progressPct = total > 0 ? Math.round((answeredCount / total) * 100) : 0;
  const current = questions[step];
  const passed = submitted ? resultStars >= passRequired : isPhaseQuizPassed(displayProgress, phase.id);

  const firstUnanswered = useMemo(
    () => questions.findIndex((q) => answers[q.id] === undefined),
    [answers, questions],
  );

  const handleSelect = useCallback(
    (questionId: string, optIdx: number) => {
      if (submitted) return;
      setAnswers((prev) => ({ ...prev, [questionId]: optIdx }));
    },
    [submitted],
  );

  const goToStep = useCallback(
    (idx: number) => {
      if (submitted) return;
      setStep(Math.max(0, Math.min(total - 1, idx)));
    },
    [submitted, total],
  );

  const handleSubmit = useCallback(() => {
    if (firstUnanswered >= 0) {
      toast.error(`Answer question ${firstUnanswered + 1} before submitting.`);
      setStep(firstUnanswered);
      return;
    }
    const stars = scoreAnswers(questions, answers);
    const attemptAnswers = buildAttemptAnswers(questions, answers);
    setResultStars(stars);
    setSubmitted(true);
    setShowReview(false);
    void submitQuizResult(phase.id, stars, attemptAnswers);

    if (stars >= passRequired) {
      toast.success(`${stars}/${total} — phase certified!`, {
        description: "Next phase unlocked. Great work!",
      });
    } else {
      toast.error(`${stars}/${total} — keep studying and try again.`, {
        description: `You need ${passRequired}/${total} to pass.`,
      });
    }
  }, [answers, firstUnanswered, passRequired, phase.id, questions, submitQuizResult, total]);

  const handleRetry = () => {
    setAnswers({});
    setSubmitted(false);
    setResultStars(0);
    setShowReview(false);
    setStep(0);
  };

  const nextPhase = (() => {
    const phases = FIXFY_SCHOOL_PHASES.map((p) => p.id);
    const idx = phases.indexOf(phase.id);
    if (idx < 0 || idx >= phases.length - 1) return null;
    return getLocalizedPhase(phases[idx + 1]!, locale);
  })();

  if (!current && !submitted) {
    return <p className="text-sm text-text-secondary">No quiz questions for this phase yet.</p>;
  }

  return (
    <div className="w-full space-y-5">
      {/* Header */}
      <div className="rounded-2xl border border-border-light bg-card p-5 sm:p-6 space-y-4 text-center">
        <div className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#E94A02] m-0">
            {phase.subtitle} · Final quiz
          </p>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary m-0">{phase.title}</h1>
        </div>

        {!submitted && (
          <>
            <div className="inline-flex flex-col items-center gap-0.5">
              <p className="text-2xl font-bold tabular-nums text-text-primary m-0">
                {answeredCount}/{total}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-text-tertiary m-0">answered</p>
            </div>
            <div className="h-2 w-full max-w-md mx-auto rounded-full bg-surface-tertiary overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#E94A02] to-[#FF8A5C] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-text-secondary m-0">
              {total} questions · <strong className="text-text-primary">{passRequired}/{total} to pass</strong>
              {bestStars > 0 ? ` · Best: ${bestStars}/${total}` : ""}
            </p>
          </>
        )}
      </div>

      {/* Result banner */}
      {submitted && (
        <div
          className={cn(
            "rounded-2xl border p-6 text-center space-y-4",
            passed
              ? "border-emerald-400/50 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-[#0c0c12]"
              : "border-amber-300/40 bg-gradient-to-br from-amber-50/80 to-white dark:from-amber-950/30 dark:to-[#0c0c12]",
          )}
        >
          {passed ? (
            <>
              <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-emerald-500/15 mx-auto">
                <Trophy className="h-7 w-7 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-text-primary m-0">Phase certified!</h2>
              <p className="text-sm text-text-secondary m-0">
                {resultStars}/{total} correct — {nextPhase ? `${nextPhase.title} is unlocked.` : "Full certification unlocked."}
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-text-primary m-0">Not quite yet</h2>
              <p className="text-sm text-text-secondary m-0">
                You got {resultStars}/{total}. Need {passRequired}/{total} to pass — review and try again.
              </p>
            </>
          )}
          <StarRating stars={resultStars} max={total} animate={submitted} />
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {!passed && (
              <Button size="sm" onClick={handleRetry} icon={<RotateCcw className="h-4 w-4" />}>
                Try again
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowReview((v) => !v)}
            >
              {showReview ? "Hide review" : "Review answers"}
            </Button>
            {passed && nextPhase && (
              <Button
                size="sm"
                onClick={() => router.push(`/school/${nextPhase.id}`)}
                icon={<ArrowRight className="h-4 w-4" />}
              >
                Next phase
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Step navigator dots */}
      {!submitted && (
        <div className="flex flex-wrap justify-center gap-2">
          {questions.map((q, idx) => {
            const answered = answers[q.id] !== undefined;
            const active = idx === step;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => goToStep(idx)}
                aria-label={`Question ${idx + 1}${answered ? ", answered" : ", unanswered"}`}
                className={cn(
                  "h-9 min-w-[2.25rem] px-2 rounded-lg text-xs font-bold tabular-nums transition-all border",
                  active && "border-[#E94A02] bg-[#FFF4ED] text-[#E94A02] scale-105 shadow-sm",
                  !active && answered && "border-emerald-300 bg-emerald-50 text-emerald-700",
                  !active && !answered && "border-border-light bg-card text-text-tertiary hover:border-[#E94A02]/40",
                )}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
      )}

      {/* Active question OR full review */}
      {submitted && showReview ? (
        <div className="space-y-4">
          {questions.map((q, idx) => (
            <QuestionReviewCard
              key={q.id}
              q={q}
              idx={idx}
              selected={answers[q.id]}
              submitted
              showExplanation
            />
          ))}
        </div>
      ) : !submitted && current ? (
        <div className="rounded-2xl border border-border-light bg-card p-5 sm:p-6 space-y-5 shadow-sm">
          <div className="flex flex-col items-center gap-1 text-center sm:flex-row sm:justify-between sm:text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#E94A02] m-0">
              Question {step + 1} of {total}
            </p>
            {answers[current.id] !== undefined ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                <Check className="h-3.5 w-3.5" />
                Answered
              </span>
            ) : (
              <span className="text-xs text-text-tertiary">Pick one option</span>
            )}
          </div>

          <p className="text-base sm:text-lg font-semibold text-text-primary m-0 leading-snug text-center sm:text-left">
            {current.prompt}
          </p>

          <div className="space-y-2.5" role="radiogroup" aria-label={current.prompt}>
            {current.options.map((opt, optIdx) => {
              const chosen = answers[current.id] === optIdx;
              return (
                <button
                  key={optIdx}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  onClick={() => handleSelect(current.id, optIdx)}
                  className={cn(
                    "w-full flex items-start gap-3 rounded-xl border-2 px-4 py-3.5 text-left text-sm transition-all",
                    chosen
                      ? "border-[#E94A02] bg-[#FFF4ED] dark:bg-[#2a1508]/50 shadow-sm"
                      : "border-border-light hover:border-[#E94A02]/35 hover:bg-surface-hover/60",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold",
                      chosen ? "bg-[#E94A02] text-white" : "bg-surface-tertiary text-text-secondary",
                    )}
                  >
                    {OPTION_LETTERS[optIdx] ?? "?"}
                  </span>
                  <span className="flex-1 pt-1 text-text-primary leading-relaxed">{opt}</span>
                  {chosen && <Check className="h-5 w-5 shrink-0 text-[#E94A02] mt-1.5" />}
                </button>
              );
            })}
          </div>

          <p className="text-[11px] text-text-tertiary m-0 text-center sm:text-left">
            Tap an option to select your answer.
          </p>
        </div>
      ) : null}

      {/* Nav bar — sticky inside main column (avoids viewport-center misalignment with sidebar) */}
      {!submitted && (
        <div className="sticky bottom-4 z-20 mt-2">
          <div className="rounded-2xl border border-border-light bg-card shadow-lg p-2 sm:p-2.5">
            <div className="grid grid-cols-3 gap-2 w-full">
              <Link href={`/school/${phase.id}`} className="min-w-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full !flex-nowrap whitespace-nowrap"
                  icon={<ArrowLeft className="h-4 w-4" />}
                >
                  Lessons
                </Button>
              </Link>

              <Button
                variant="outline"
                size="sm"
                className="w-full !flex-nowrap whitespace-nowrap"
                disabled={step === 0}
                onClick={() => goToStep(step - 1)}
                icon={<ChevronLeft className="h-4 w-4" />}
              >
                Back
              </Button>

              {step < total - 1 ? (
                <Button
                  size="sm"
                  className="w-full !flex-nowrap whitespace-nowrap"
                  onClick={() => goToStep(step + 1)}
                >
                  <span className="inline-flex items-center justify-center gap-1">
                    Next
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  </span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={answeredCount >= total ? "success" : "primary"}
                  className="w-full !flex-nowrap whitespace-nowrap"
                  onClick={handleSubmit}
                  disabled={answeredCount < total}
                  icon={<Sparkles className="h-4 w-4" />}
                >
                  Submit
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PhaseQuizLocked({ phaseId }: { phaseId: string }) {
  const { locale } = useFixfySchoolLocale();
  const prev = previousPhaseId(phaseId as import("@/lib/fixfy-school-curriculum").SchoolPhaseId);
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
