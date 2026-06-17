"use client";

import {
  CircleDot,
  TrendingUp,
  Zap,
  Crown,
  Gem,
  type LucideIcon,
} from "lucide-react";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import { cn, formatCurrency } from "@/lib/utils";
import {
  partnerLevelFromProgress,
  resolvePartnerLevelThresholds,
  resolvePartnerMonthlyGoal,
  type PartnerLevelIconId,
  type PartnerLevelThresholds,
  type PartnerLevelTone,
} from "@/lib/partner-revenue-goal";
import { useMemo } from "react";

const ICONS: Record<PartnerLevelIconId, LucideIcon> = {
  "circle-dot": CircleDot,
  "trending-up": TrendingUp,
  zap: Zap,
  crown: Crown,
  gem: Gem,
};

const TONE_CLASS: Record<
  PartnerLevelTone,
  { badge: string; icon: string; bar: string }
> = {
  mute: {
    badge: "bg-surface-tertiary text-text-secondary border-border-light",
    icon: "text-text-tertiary",
    bar: "bg-text-tertiary",
  },
  coral: {
    badge: "bg-orange-50 text-orange-700 border-orange-200",
    icon: "text-orange-600",
    bar: "bg-orange-500",
  },
  amber: {
    badge: "bg-amber-50 text-amber-800 border-amber-200",
    icon: "text-amber-600",
    bar: "bg-amber-500",
  },
  green: {
    badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
    icon: "text-emerald-600",
    bar: "bg-emerald-500",
  },
  navy: {
    badge: "bg-primary/10 text-primary border-primary/20",
    icon: "text-primary",
    bar: "bg-primary",
  },
};

function usePartnerLevelThresholds(): PartnerLevelThresholds {
  const { setup } = useFrontendSetup();
  return useMemo(() => resolvePartnerLevelThresholds(setup), [setup]);
}

function levelFromEarnings(
  monthEarned: number,
  weekEarned: number | undefined,
  thresholds: PartnerLevelThresholds,
) {
  const goal = resolvePartnerMonthlyGoal(weekEarned ?? monthEarned / 4, thresholds);
  return partnerLevelFromProgress(monthEarned, goal, thresholds);
}

export function PartnerLevelIcon({
  level,
  icon,
  tone,
  size = "sm",
  className,
}: {
  level: number;
  icon: PartnerLevelIconId;
  tone: PartnerLevelTone;
  size?: "sm" | "md";
  className?: string;
}) {
  const Icon = ICONS[icon];
  const toneClass = TONE_CLASS[tone];
  const dim = size === "md" ? "h-8 w-8" : "h-7 w-7";
  const iconDim = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";

  return (
    <span
      title={`Level ${level}`}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border",
        dim,
        toneClass.badge,
        className,
      )}
    >
      <Icon className={cn(iconDim, toneClass.icon)} />
    </span>
  );
}

/** Compact badge for partners table rows. */
export function PartnerLevelBadge({
  monthEarned,
  weekEarned,
  className,
  dense = false,
}: {
  monthEarned: number;
  weekEarned?: number;
  className?: string;
  /** Tighter layout for Revenue / Level table column — bar matches revenue width. */
  dense?: boolean;
}) {
  const thresholds = usePartnerLevelThresholds();
  const state = levelFromEarnings(monthEarned, weekEarned, thresholds);
  const toneClass = TONE_CLASS[state.tone];

  if (dense) {
    return (
      <div className={cn("min-w-0 w-full", className)}>
        <div className="flex items-center justify-center gap-1 min-w-0">
          <PartnerLevelIcon level={state.level} icon={state.icon} tone={state.tone} size="sm" className="h-5 w-5 [&_svg]:h-3 [&_svg]:w-3" />
          <p className="text-[10px] font-semibold text-text-primary truncate leading-tight">
            L{state.level} · {state.name}
          </p>
        </div>
        <p className="text-[9px] text-text-tertiary tabular-nums text-center leading-tight mt-0.5">
          {state.pct}% of goal
        </p>
        <div className="h-0.5 w-full rounded-full bg-surface-tertiary overflow-hidden mt-0.5">
          <div
            className={cn("h-full rounded-full transition-all", toneClass.bar)}
            style={{ width: `${state.barPct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center gap-1 min-w-0", className)}>
      <div className="flex items-center gap-1.5">
        <PartnerLevelIcon level={state.level} icon={state.icon} tone={state.tone} size="sm" />
        <div className="min-w-0 text-left">
          <p className="text-xs font-semibold text-text-primary truncate">
            L{state.level} · {state.name}
          </p>
          <p className="text-[10px] text-text-tertiary tabular-nums">{state.pct}% of goal</p>
        </div>
      </div>
      <div className="h-1 w-full max-w-[7rem] rounded-full bg-surface-tertiary overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", toneClass.bar)}
          style={{ width: `${state.barPct}%` }}
        />
      </div>
    </div>
  );
}

/** Full card for partner detail overview. */
export function PartnerLevelCard({
  monthEarned,
  weekEarned,
  compact = false,
  className,
}: {
  monthEarned: number;
  weekEarned?: number;
  compact?: boolean;
  className?: string;
}) {
  const thresholds = usePartnerLevelThresholds();
  const state = levelFromEarnings(monthEarned, weekEarned, thresholds);
  const toneClass = TONE_CLASS[state.tone];

  if (compact) {
    return (
      <div className={cn("p-2 rounded-lg bg-surface-hover border border-border-light min-w-0", className)}>
        <div className="flex items-center gap-1.5 min-w-0">
          <PartnerLevelIcon level={state.level} icon={state.icon} tone={state.tone} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide leading-none">
              Month level
            </p>
            <p className="text-sm font-bold text-text-primary leading-tight truncate">
              L{state.level} · {state.name}
            </p>
          </div>
          <span className="text-[10px] text-text-tertiary tabular-nums shrink-0">{state.pct}%</span>
        </div>
        <div className="h-1 w-full rounded-full bg-surface-tertiary overflow-hidden mt-1.5">
          <div
            className={cn("h-full rounded-full transition-all", toneClass.bar)}
            style={{ width: `${state.barPct}%` }}
          />
        </div>
        <p className="text-[9px] text-text-tertiary mt-1 truncate tabular-nums">
          {formatCurrency(state.earned)} / {formatCurrency(state.goal)} · {state.footerLine}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("p-3 rounded-xl bg-surface-hover border border-border-light", className)}>
      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Month level</p>
      <div className="flex items-center gap-2 mt-1.5">
        <PartnerLevelIcon level={state.level} icon={state.icon} tone={state.tone} size="md" />
        <div className="min-w-0">
          <p className="text-lg font-bold text-text-primary leading-tight">
            Level {state.level} · {state.name}
          </p>
          <p className="text-[10px] text-text-tertiary tabular-nums mt-0.5">
            {formatCurrency(state.earned)} / {formatCurrency(state.goal)} · {state.pct}%
          </p>
        </div>
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface-tertiary overflow-hidden mt-2">
        <div
          className={cn("h-full rounded-full transition-all", toneClass.bar)}
          style={{ width: `${state.barPct}%` }}
        />
      </div>
      <p className="text-[10px] text-text-tertiary mt-1.5 leading-snug">{state.footerLine}</p>
    </div>
  );
}
