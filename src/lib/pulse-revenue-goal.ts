import {
  countWorkingDaysInRange,
  monthlyWorkingDays,
  parseFrontendSetup,
  type FrontendSetup,
  type PulseRevenueGoalMode,
} from "./frontend-setup";

export type PulseRevenueGoalSuggestions = {
  breakevenMonthly: number | null;
  healthyMonthly: number | null;
  breakevenDaily: number | null;
  healthyDaily: number | null;
  error?: string;
};

export type PulseRevenueGoalStatus = "above" | "on_track" | "below" | "unset";

export function computeBreakevenMonthly(fixedCostsMonthly: number, targetMarginPct: number): number | null {
  const gm = targetMarginPct / 100;
  if (gm <= 0) return null;
  if (fixedCostsMonthly <= 0) return 0;
  return fixedCostsMonthly / gm;
}

export function computeHealthyMonthly(
  fixedCostsMonthly: number,
  targetMarginPct: number,
  healthyNetMarginPct: number,
): number | null {
  const gm = targetMarginPct / 100;
  const healthyNet = healthyNetMarginPct / 100;
  if (gm <= healthyNet) return null;
  if (fixedCostsMonthly <= 0) return 0;
  return fixedCostsMonthly / (gm - healthyNet);
}

export function computePulseRevenueGoalSuggestions(
  fixedCostsMonthly: number,
  setup?: FrontendSetup | null,
): PulseRevenueGoalSuggestions {
  const s = setup ?? parseFrontendSetup(null);
  const targetMarginPct = s.target_margin_pct ?? 40;
  const healthyNetPct = s.pulse_healthy_net_margin_pct ?? 30;
  const gm = targetMarginPct / 100;
  const healthyNet = healthyNetPct / 100;

  if (gm <= healthyNet) {
    return {
      breakevenMonthly: computeBreakevenMonthly(fixedCostsMonthly, targetMarginPct),
      healthyMonthly: null,
      breakevenDaily: null,
      healthyDaily: null,
      error: "Target gross margin must exceed healthy net margin %.",
    };
  }

  const breakevenMonthly = computeBreakevenMonthly(fixedCostsMonthly, targetMarginPct);
  const healthyMonthly = computeHealthyMonthly(fixedCostsMonthly, targetMarginPct, healthyNetPct);
  const monthlyWd = monthlyWorkingDays(s);
  const breakevenDaily =
    breakevenMonthly != null && monthlyWd > 0 ? breakevenMonthly / monthlyWd : null;
  const healthyDaily = healthyMonthly != null && monthlyWd > 0 ? healthyMonthly / monthlyWd : null;

  return { breakevenMonthly, healthyMonthly, breakevenDaily, healthyDaily };
}

export function resolvePulseMonthlyRevenueGoal(
  setup: FrontendSetup | null | undefined,
  fixedCostsMonthly: number,
): { monthlyGoal: number | null; error?: string } {
  const s = setup ?? parseFrontendSetup(null);
  const mode: PulseRevenueGoalMode = s.pulse_revenue_goal_mode ?? "healthy";
  const suggestions = computePulseRevenueGoalSuggestions(fixedCostsMonthly, s);
  const override = s.pulse_revenue_goal_monthly_gbp;

  if (mode !== "manual" && override != null && override > 0) {
    return { monthlyGoal: override };
  }

  if (mode === "manual") {
    const manual = s.pulse_revenue_goal_monthly_gbp;
    if (manual != null && manual > 0) return { monthlyGoal: manual };
    return { monthlyGoal: null, error: "Set a manual monthly revenue goal in Setup." };
  }

  if (mode === "breakeven") {
    if (suggestions.breakevenMonthly == null) {
      return { monthlyGoal: null, error: suggestions.error };
    }
    return { monthlyGoal: suggestions.breakevenMonthly };
  }

  if (suggestions.healthyMonthly == null) {
    return { monthlyGoal: null, error: suggestions.error ?? "Cannot compute healthy goal." };
  }
  return { monthlyGoal: suggestions.healthyMonthly };
}

export function resolvePulsePeriodRevenueGoal(
  bounds: { from: Date; to: Date },
  setup: FrontendSetup | null | undefined,
  monthlyGoal: number | null,
): { periodGoal: number; workingDaysInPeriod: number; dailyGoal: number | null } {
  const s = setup ?? parseFrontendSetup(null);
  const workingDaysInPeriod = countWorkingDaysInRange(bounds.from, bounds.to, s);
  const monthlyWd = monthlyWorkingDays(s);

  if (!monthlyGoal || monthlyGoal <= 0 || monthlyWd <= 0 || workingDaysInPeriod <= 0) {
    return { periodGoal: 0, workingDaysInPeriod, dailyGoal: null };
  }

  const dailyGoal = monthlyGoal / monthlyWd;
  const periodGoal = dailyGoal * workingDaysInPeriod;
  return { periodGoal, workingDaysInPeriod, dailyGoal };
}

export function pulseRevenueGoalStatus(
  actualRevenue: number,
  periodGoal: number,
): { status: PulseRevenueGoalStatus; delta: number; pctOfGoal: number | null } {
  if (periodGoal <= 0) {
    return { status: "unset", delta: actualRevenue, pctOfGoal: null };
  }
  const delta = actualRevenue - periodGoal;
  const pctOfGoal = (actualRevenue / periodGoal) * 100;
  let status: PulseRevenueGoalStatus;
  if (actualRevenue >= periodGoal) status = "above";
  else if (pctOfGoal >= 95) status = "on_track";
  else status = "below";
  return { status, delta, pctOfGoal };
}
