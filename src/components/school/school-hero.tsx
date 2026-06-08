"use client";

import { Trophy, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { MicroLabel } from "@/components/fx/primitives";
import { levelFromXp } from "@/lib/fixfy-school-curriculum";
import type { SchoolProgress } from "@/lib/fixfy-school-progress";
import { earnedAchievements, totalEarnedXp } from "@/lib/fixfy-school-progress";
import { SchoolLanguageSwitcher } from "@/components/school/school-language-switcher";
import { useFixfySchoolLocale } from "@/hooks/use-fixfy-school-locale";
import { getLocalizedAchievements } from "@/lib/fixfy-school-localized";

type Props = {
  progress: SchoolProgress;
  overallPercent: number;
};

export function SchoolHero({ progress, overallPercent }: Props) {
  const { locale } = useFixfySchoolLocale();
  const xp = totalEarnedXp(progress);
  const { level, label, progress: levelProgress } = levelFromXp(xp);
  const achievements = earnedAchievements(progress);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border-light bg-gradient-to-br from-[#020034] via-[#0A0054] to-[#1A0085] p-6 sm:p-8 text-white shadow-lg">
      <div className="absolute -top-20 -right-16 h-56 w-56 rounded-full bg-white/[0.04] pointer-events-none" />
      <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-[#E94A02]/10 pointer-events-none" />

      <div className="relative flex flex-col gap-4 mb-2 sm:flex-row sm:items-center sm:justify-end">
        <SchoolLanguageSwitcher variant="hero" className="sm:ml-auto" />
      </div>

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3 min-w-0">
          <MicroLabel className="!text-[#FF8A5C]">Fixfy School</MicroLabel>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight m-0">
            Learn Fixfy in 3 phases
          </h1>
          <p className="text-sm text-white/65 max-w-xl m-0 leading-relaxed">
            Start with Zendesk, then the Operating System and Trade Portal — earn XP, pass each
            phase quiz with 5/5 stars to unlock the next level.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 shrink-0">
          <div className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 px-5 py-4 min-w-[10rem]">
            <div className="flex items-center gap-2 text-white/60 text-xs font-medium uppercase tracking-wide">
              <Zap className="h-3.5 w-3.5 text-[#FF8A5C]" />
              Level {level}
            </div>
            <p className="text-xl font-bold mt-1 tabular-nums">{label}</p>
            <div className="mt-2 h-1.5 rounded-full bg-white/15 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#FF6B2B] to-[#E94A02] transition-all duration-500"
                style={{ width: `${levelProgress}%` }}
              />
            </div>
            <p className="text-[11px] text-white/50 mt-1.5 tabular-nums">{xp} XP earned</p>
          </div>

          <div className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 px-5 py-4 min-w-[10rem]">
            <div className="flex items-center gap-2 text-white/60 text-xs font-medium uppercase tracking-wide">
              <Trophy className="h-3.5 w-3.5 text-amber-300" />
              Progress
            </div>
            <p className="text-xl font-bold mt-1 tabular-nums">{overallPercent}%</p>
            <div className="mt-2 h-1.5 rounded-full bg-white/15 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                style={{ width: `${overallPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-white/50 mt-1.5">
              {achievements.length} badge{achievements.length === 1 ? "" : "s"} earned
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SchoolAchievementStrip({
  progress,
  locale = "en",
}: {
  progress: SchoolProgress;
  locale?: "en" | "pt";
}) {
  const earned = earnedAchievements(progress);
  const defs = getLocalizedAchievements(locale);
  const defById = new Map(defs.map((d) => [d.id, d]));
  const locked = 5 - earned.length;

  return (
    <div className="flex flex-wrap gap-2">
      {earned.map((a) => {
        const def = defById.get(a.id) ?? a;
        return (
          <span
            key={a.id}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
              "bg-amber-50 text-amber-900 border border-amber-200/80",
              "dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-800/50",
            )}
            title={def.description}
          >
            <span aria-hidden>{a.emoji}</span>
            {def.title}
          </span>
        );
      })}
      {locked > 0 &&
        Array.from({ length: Math.min(locked, 3) }).map((_, i) => (
          <span
            key={`locked-${i}`}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-surface-hover text-text-tertiary border border-dashed border-border-light"
          >
            <span aria-hidden>🔒</span>
            Locked
          </span>
        ))}
    </div>
  );
}
