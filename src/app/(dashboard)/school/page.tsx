"use client";

import Link from "next/link";
import { PlayCircle } from "lucide-react";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { SchoolHero, SchoolAchievementStrip } from "@/components/school/school-hero";
import { PhaseCard } from "@/components/school/phase-card";
import { overallSchoolPercent } from "@/components/school/lesson-viewer";
import { nextIncompleteLesson } from "@/lib/fixfy-school-progress";
import { useFixfySchoolProgress } from "@/hooks/use-fixfy-school-progress";
import { useFixfySchoolLocale } from "@/hooks/use-fixfy-school-locale";
import { getLocalizedPhases } from "@/lib/fixfy-school-localized";

export default function FixfySchoolPage() {
  const { progress, loading } = useFixfySchoolProgress();
  const { locale } = useFixfySchoolLocale();
  const phases = getLocalizedPhases(locale);

  const overallPercent = overallSchoolPercent(progress);
  const continueId = nextIncompleteLesson(progress);

  return (
    <PageTransition>
      <div className="space-y-6 max-w-5xl">
        <SchoolHero progress={progress} overallPercent={overallPercent} />

        {continueId && !loading && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E94A02]/25 bg-[#FFF4ED]/60 dark:bg-[#2a1508]/40 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-text-primary m-0">Continue where you left off</p>
              <p className="text-xs text-text-tertiary m-0 mt-0.5">Pick up your next lesson and earn XP.</p>
            </div>
            <Link href={`/school/lesson/${continueId}`}>
              <Button size="sm" icon={<PlayCircle className="h-4 w-4" />}>
                Resume
              </Button>
            </Link>
          </div>
        )}

        <div>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Your learning path
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...phases]
              .sort((a, b) => a.order - b.order)
              .map((phase) => (
                <PhaseCard key={phase.id} phase={phase} progress={progress} />
              ))}
          </div>
        </div>

        <div className="rounded-xl border border-border-light bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-text-primary m-0">Badges</h2>
          <SchoolAchievementStrip progress={progress} locale={locale} />
          <p className="text-xs text-text-tertiary m-0 leading-relaxed">
            Complete all lessons and pass each phase quiz to earn badges. Finish all five
            phases to unlock <strong className="text-text-secondary">Fixfy Scholar</strong>.
          </p>
        </div>
      </div>
    </PageTransition>
  );
}
