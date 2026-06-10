"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { PageTransition } from "@/components/layout/page-transition";
import { LessonList } from "@/components/school/lesson-list";
import { SchoolLanguageSwitcher } from "@/components/school/school-language-switcher";
import { PhaseQuizCta, PhaseQuizLocked } from "@/components/school/phase-quiz";
import { useFixfySchoolLocale } from "@/hooks/use-fixfy-school-locale";
import { getLocalizedPhase } from "@/lib/fixfy-school-localized";
import {
  isPhaseLessonsComplete,
  isPhaseUnlocked,
  isQuizAvailable,
  phaseProgress,
} from "@/lib/fixfy-school-progress";
import { useFixfySchoolProgress } from "@/hooks/use-fixfy-school-progress";

export default function SchoolPhasePage() {
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
  const stats = phaseProgress(p, phase.id);

  return (
    <PageTransition>
      <div className="space-y-6 max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/school"
            className="inline-flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Fixfy School
          </Link>
          <SchoolLanguageSwitcher variant="inline" />
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#E94A02]">{phase.subtitle}</p>
          <h1 className="text-2xl font-bold text-text-primary m-0">{phase.title}</h1>
          <p className="text-sm text-text-secondary m-0 mt-2 leading-relaxed">{phase.description}</p>
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
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-secondary">
                {stats.completed} of {stats.total} lessons complete
              </span>
              <span className="font-semibold text-text-primary tabular-nums">{stats.percent}%</span>
            </div>
            <div className="h-2 rounded-full bg-surface-hover overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#FF6B2B] to-[#E94A02] transition-all"
                style={{ width: `${stats.percent}%` }}
              />
            </div>
            {phase.id === "fixfy-os" && (
              <p className="text-xs text-text-tertiary">
                All lessons open the same interactive guide — scrolled to the right chapter.{" "}
                <a
                  href="/school/fixfy-os/guide.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#E94A02] font-medium hover:underline"
                >
                  Open full guide
                </a>
              </p>
            )}
            {phase.id === "zendesk" && (
              <p className="text-xs text-text-tertiary">
                Full v3 manual — each lesson opens the right chapter.{" "}
                <a
                  href={locale === "pt" ? "/school/zendesk/guide.pt.html" : "/school/zendesk/guide.en.html"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 font-medium hover:underline"
                >
                  Open full guide
                </a>
              </p>
            )}
            {phase.id === "trade-portal" && (
              <p className="text-xs text-text-tertiary">
                Full partner training — each lesson jumps to the right chapter.{" "}
                <a
                  href="/school/trade-portal/guide.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-600 font-medium hover:underline"
                >
                  Open full guide
                </a>
              </p>
            )}
            <LessonList phase={phase} progress={p} />
            {isQuizAvailable(p, phase.id) ? (
              <PhaseQuizCta phase={phase} progress={p} />
            ) : !isPhaseLessonsComplete(p, phase.id) ? (
              <PhaseQuizLocked phaseId={phase.id} />
            ) : null}
          </>
        )}
      </div>
    </PageTransition>
  );
}
