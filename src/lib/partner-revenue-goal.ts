/** Partner monthly revenue levels — mirrors trade portal gamification. */
export const DEFAULT_PARTNER_MONTHLY_GOAL_GBP = 5000;

export type PartnerLevelGoalMode = "fixed" | "weekly_pace";

export type PartnerLevelTone = "mute" | "coral" | "amber" | "green" | "navy";

export type PartnerLevelConfig = {
  level: number;
  minPct: number;
  name: string;
  priorityLabel: string;
  tone: PartnerLevelTone;
};

export const PARTNER_LEVELS: readonly PartnerLevelConfig[] = [
  {
    level: 1,
    minPct: 0,
    name: "Starter",
    priorityLabel: "Standard queue for leads, quotes & jobs",
    tone: "mute",
  },
  {
    level: 2,
    minPct: 25,
    name: "Rising",
    priorityLabel: "Better visibility on new opportunities",
    tone: "coral",
  },
  {
    level: 3,
    minPct: 50,
    name: "Priority",
    priorityLabel: "Higher priority on leads, quotes & jobs",
    tone: "amber",
  },
  {
    level: 4,
    minPct: 100,
    name: "Elite",
    priorityLabel: "Top priority — first to see new work",
    tone: "green",
  },
] as const;

export const ELITE_PLUS_CONFIG = {
  level: 5,
  name: "Elite+",
  priorityLabel: "Maximum priority — doubled monthly target",
  tone: "navy" as PartnerLevelTone,
  stretchMultiplier: 2,
};

export type PartnerLevelIconId = "circle-dot" | "trending-up" | "zap" | "crown" | "gem";

export const PARTNER_LEVEL_ICONS: Record<number, PartnerLevelIconId> = {
  1: "circle-dot",
  2: "trending-up",
  3: "zap",
  4: "crown",
  5: "gem",
};

export type PartnerLevelThresholds = {
  monthlyGoalGbp: number;
  goalMode: PartnerLevelGoalMode;
  l2MinGbp: number;
  l3MinGbp: number;
  l4MinGbp: number;
  elitePlusMultiplier: number;
};

export type PartnerLevelSetupSlice = {
  partner_level_monthly_goal_gbp?: number;
  partner_level_goal_mode?: PartnerLevelGoalMode;
  partner_level_l2_min_gbp?: number;
  partner_level_l3_min_gbp?: number;
  partner_level_l4_min_gbp?: number;
  partner_level_elite_plus_multiplier?: number;
};

export const MIN_PARTNER_LEVEL_GBP = 100;
export const MAX_PARTNER_LEVEL_GBP = 500_000;
export const MIN_PARTNER_ELITE_PLUS_MULTIPLIER = 1.5;
export const MAX_PARTNER_ELITE_PLUS_MULTIPLIER = 5;

export const DEFAULT_PARTNER_LEVEL_THRESHOLDS: PartnerLevelThresholds = {
  monthlyGoalGbp: DEFAULT_PARTNER_MONTHLY_GOAL_GBP,
  goalMode: "weekly_pace",
  l2MinGbp: 1250,
  l3MinGbp: 2500,
  l4MinGbp: DEFAULT_PARTNER_MONTHLY_GOAL_GBP,
  elitePlusMultiplier: ELITE_PLUS_CONFIG.stretchMultiplier,
};

export function clampPartnerLevelGbp(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_PARTNER_LEVEL_GBP, Math.max(MIN_PARTNER_LEVEL_GBP, Math.round(n)));
}

export function clampElitePlusMultiplier(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_PARTNER_ELITE_PLUS_MULTIPLIER, Math.max(MIN_PARTNER_ELITE_PLUS_MULTIPLIER, Math.round(n * 10) / 10));
}

export function resolvePartnerLevelThresholds(setup?: PartnerLevelSetupSlice | null): PartnerLevelThresholds {
  const monthlyGoalGbp = clampPartnerLevelGbp(
    setup?.partner_level_monthly_goal_gbp,
    DEFAULT_PARTNER_MONTHLY_GOAL_GBP,
  );
  const goalMode: PartnerLevelGoalMode =
    setup?.partner_level_goal_mode === "fixed" || setup?.partner_level_goal_mode === "weekly_pace"
      ? setup.partner_level_goal_mode
      : DEFAULT_PARTNER_LEVEL_THRESHOLDS.goalMode;

  let l2MinGbp = clampPartnerLevelGbp(setup?.partner_level_l2_min_gbp, Math.round(monthlyGoalGbp * 0.25));
  let l3MinGbp = clampPartnerLevelGbp(setup?.partner_level_l3_min_gbp, Math.round(monthlyGoalGbp * 0.5));
  let l4MinGbp = clampPartnerLevelGbp(setup?.partner_level_l4_min_gbp, monthlyGoalGbp);

  l2MinGbp = Math.min(l2MinGbp, l3MinGbp, l4MinGbp);
  l3MinGbp = Math.max(l2MinGbp, Math.min(l3MinGbp, l4MinGbp));
  l4MinGbp = Math.max(l3MinGbp, l4MinGbp);

  return {
    monthlyGoalGbp,
    goalMode,
    l2MinGbp,
    l3MinGbp,
    l4MinGbp,
    elitePlusMultiplier: clampElitePlusMultiplier(
      setup?.partner_level_elite_plus_multiplier,
      DEFAULT_PARTNER_LEVEL_THRESHOLDS.elitePlusMultiplier,
    ),
  };
}

export function resolvePartnerMonthlyGoal(
  weekEarnings: number,
  thresholds: PartnerLevelThresholds = DEFAULT_PARTNER_LEVEL_THRESHOLDS,
): number {
  if (thresholds.goalMode === "fixed") return thresholds.monthlyGoalGbp;
  if (weekEarnings <= 0) return thresholds.monthlyGoalGbp;
  const pace = Math.ceil((weekEarnings * 4.3) / 250) * 250;
  return Math.max(thresholds.monthlyGoalGbp, pace);
}

export type PartnerLevelState = {
  level: number;
  name: string;
  priorityLabel: string;
  tone: PartnerLevelTone;
  pct: number;
  goal: number;
  earned: number;
  isElitePlus: boolean;
  footerLine: string;
  barPct: number;
  icon: PartnerLevelIconId;
};

function levelForEarned(earned: number, thresholds: PartnerLevelThresholds): PartnerLevelConfig {
  if (earned >= thresholds.l4MinGbp) return PARTNER_LEVELS[3];
  if (earned >= thresholds.l3MinGbp) return PARTNER_LEVELS[2];
  if (earned >= thresholds.l2MinGbp) return PARTNER_LEVELS[1];
  return PARTNER_LEVELS[0];
}

function nextLevelThreshold(currentLevel: number, thresholds: PartnerLevelThresholds): number | null {
  if (currentLevel === 1) return thresholds.l2MinGbp;
  if (currentLevel === 2) return thresholds.l3MinGbp;
  if (currentLevel === 3) return thresholds.l4MinGbp;
  if (currentLevel === 4) return thresholds.l4MinGbp * thresholds.elitePlusMultiplier;
  return null;
}

export function partnerLevelFromProgress(
  earned: number,
  goal: number,
  thresholds: PartnerLevelThresholds = DEFAULT_PARTNER_LEVEL_THRESHOLDS,
): PartnerLevelState {
  const safeGoal = Math.max(1, goal);
  const pct = Math.round((earned / safeGoal) * 100);
  const stretchGoal = thresholds.l4MinGbp * thresholds.elitePlusMultiplier;
  const isElitePlus = earned >= stretchGoal;

  if (isElitePlus) {
    return {
      level: ELITE_PLUS_CONFIG.level,
      name: ELITE_PLUS_CONFIG.name,
      priorityLabel: ELITE_PLUS_CONFIG.priorityLabel,
      tone: ELITE_PLUS_CONFIG.tone,
      pct,
      goal: safeGoal,
      earned,
      isElitePlus: true,
      footerLine: ELITE_PLUS_CONFIG.priorityLabel,
      barPct: 100,
      icon: PARTNER_LEVEL_ICONS[5],
    };
  }

  if (earned >= thresholds.l4MinGbp) {
    const toDouble = Math.max(0, stretchGoal - earned);
    return {
      level: PARTNER_LEVELS[3].level,
      name: PARTNER_LEVELS[3].name,
      priorityLabel: PARTNER_LEVELS[3].priorityLabel,
      tone: PARTNER_LEVELS[3].tone,
      pct,
      goal: safeGoal,
      earned,
      isElitePlus: false,
      footerLine:
        toDouble > 0
          ? `Elite — £${Math.ceil(toDouble).toLocaleString("en-GB")} to Elite+`
          : "Elite — top priority this month",
      barPct: 100,
      icon: PARTNER_LEVEL_ICONS[4],
    };
  }

  const current = levelForEarned(earned, thresholds);
  const nextThreshold = nextLevelThreshold(current.level, thresholds);
  const amountToNext =
    nextThreshold != null ? Math.max(0, Math.ceil(nextThreshold - earned)) : 0;
  const nextLevel = current.level + 1;

  return {
    level: current.level,
    name: current.name,
    priorityLabel: current.priorityLabel,
    tone: current.tone,
    pct,
    goal: safeGoal,
    earned,
    isElitePlus: false,
    footerLine:
      nextThreshold != null && amountToNext > 0
        ? `£${amountToNext.toLocaleString("en-GB")} to Level ${nextLevel}`
        : current.priorityLabel,
    barPct: Math.min(100, pct),
    icon: PARTNER_LEVEL_ICONS[current.level] ?? "circle-dot",
  };
}
