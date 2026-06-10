"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { PageTransition } from "@/components/layout/page-transition";
import { PhaseQuiz, PhaseQuizLocked } from "@/components/school/phase-quiz";
import { SchoolLanguageSwitcher } from "@/components/school/school-language-switcher";
import { useFixfySchoolLocale } from "@/hooks/use-fixfy-school-locale";
import { getLocalizedPhase } from "@/lib/fixfy-school-localized";
import { isPhaseUnlocked, isQuizAvailable } from "@/lib/fixfy-school-progress";
import { useFixfySchoolProgress } from "@/hooks/use-fixfy-school-progress";

export default function SchoolQuizPage() {
  const params = useParams();
  const phaseId = typeof params.phaseId === "string" ? params.phaseId : "";
  const { locale } = useFixfySchoolLocale();
  const phase = getLocalizedPhase(phaseId, locale);
  const { progress } = useFixfySchoolProgress();

  if (!phase) {
    return (
      <PageTransition>
        <p className="text-text-secondary">Phase not found.</p>
        <Link href="/school" className="text-[#E94A02] text-sm font-medium">
          Back to Fixfy School
        </Link>
      </PageTransition>
    );
  }

  const p = progress;
  const unlocked = isPhaseUnlocked(p, phase.id);
  const quizReady = isQuizAvailable(p, phase.id);

  return (
    <PageTransition>
      <div className="space-y-6 max-w-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/school/${phase.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {phase.title}
          </Link>
          <SchoolLanguageSwitcher variant="inline" />
        </div>

        {!unlocked ? (
          <div className="rounded-xl border border-dashed border-border-light bg-surface-hover/40 p-8 text-center">
            <Lock className="h-10 w-10 text-text-tertiary mx-auto mb-3" />
            <p className="text-sm font-medium text-text-secondary">This phase is locked</p>
            <p className="text-xs text-text-tertiary mt-1">
              Pass the previous phase quiz to unlock.
            </p>
            <Link href="/school" className="text-[#E94A02] text-sm font-medium mt-4 inline-block">
              Back to overview
            </Link>
          </div>
        ) : !quizReady ? (
          <PhaseQuizLocked phaseId={phase.id} />
        ) : (
          <PhaseQuiz phase={phase} progress={p} />
        )}
      </div>
    </PageTransition>
  );
}
