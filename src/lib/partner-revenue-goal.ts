/** Partner monthly revenue levels — mirrors trade portal gamification. */
export const DEFAULT_PARTNER_MONTHLY_GOAL_GBP = 5000;

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

export function resolvePartnerMonthlyGoal(weekEarnings: number): number {
  if (weekEarnings <= 0) return DEFAULT_PARTNER_MONTHLY_GOAL_GBP;
  const pace = Math.ceil((weekEarnings * 4.3) / 250) * 250;
  return Math.max(DEFAULT_PARTNER_MONTHLY_GOAL_GBP, pace);
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

function levelForPct(pct: number): PartnerLevelConfig {
  if (pct >= 100) return PARTNER_LEVELS[3];
  if (pct >= 50) return PARTNER_LEVELS[2];
  if (pct >= 25) return PARTNER_LEVELS[1];
  return PARTNER_LEVELS[0];
}

export function partnerLevelFromProgress(earned: number, goal: number): PartnerLevelState {
  const safeGoal = Math.max(1, goal);
  const pct = Math.round((earned / safeGoal) * 100);
  const stretchGoal = safeGoal * ELITE_PLUS_CONFIG.stretchMultiplier;
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

  if (earned >= safeGoal) {
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
          ? `Elite — £${Math.ceil(toDouble).toLocaleString("en-GB")} to double goal`
          : "Elite — top priority this month",
      barPct: 100,
      icon: PARTNER_LEVEL_ICONS[4],
    };
  }

  const current = levelForPct(pct);
  const nextIdx = PARTNER_LEVELS.findIndex((l) => l.level === current.level) + 1;
  const next = nextIdx < PARTNER_LEVELS.length ? PARTNER_LEVELS[nextIdx] : null;
  const nextThreshold = next ? (next.minPct / 100) * safeGoal : safeGoal;
  const amountToNext = Math.max(0, Math.ceil(nextThreshold - earned));

  return {
    level: current.level,
    name: current.name,
    priorityLabel: current.priorityLabel,
    tone: current.tone,
    pct,
    goal: safeGoal,
    earned,
    isElitePlus: false,
    footerLine: next
      ? `£${amountToNext.toLocaleString("en-GB")} to Level ${next.level}`
      : current.priorityLabel,
    barPct: Math.min(100, pct),
    icon: PARTNER_LEVEL_ICONS[current.level] ?? "circle-dot",
  };
}
