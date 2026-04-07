/**
 * Browser-only preferences for Overview sales goal (no `company_settings` columns required).
 * Priority when resolving monthly GBP: monthly override → tier’s sales_goal_monthly → company → env.
 */

const STORAGE_KEY_TIER = "master-os-dashboard-sales-goal-tier-number";
const STORAGE_KEY_MONTHLY_OVERRIDE = "master-os-dashboard-sales-goal-monthly-override-gbp";

/** Commission tiers rarely exceed this; larger values are usually a mistaken £ amount pasted into the tier field. */
export const DASHBOARD_SALES_GOAL_MAX_TIER_NUMBER = 50;

export function getDashboardSalesGoalTierNumberPreference(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_TIER)?.trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1 || n > DASHBOARD_SALES_GOAL_MAX_TIER_NUMBER) {
      window.localStorage.removeItem(STORAGE_KEY_TIER);
      return null;
    }
    return Math.floor(n);
  } catch {
    return null;
  }
}

export function setDashboardSalesGoalTierNumberPreference(n: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (n == null || !Number.isFinite(n) || n < 1 || n > DASHBOARD_SALES_GOAL_MAX_TIER_NUMBER) {
      window.localStorage.removeItem(STORAGE_KEY_TIER);
    } else {
      window.localStorage.setItem(STORAGE_KEY_TIER, String(Math.floor(n)));
    }
  } catch {
    // ignore quota / private mode
  }
}

/** Optional fixed monthly target (£) stored only in this browser; wins over tier + company manual. */
export function getDashboardSalesGoalMonthlyOverrideGbp(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_MONTHLY_OVERRIDE)?.trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100) / 100;
  } catch {
    return null;
  }
}

export function setDashboardSalesGoalMonthlyOverrideGbp(n: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (n == null || !Number.isFinite(n) || n <= 0) {
      window.localStorage.removeItem(STORAGE_KEY_MONTHLY_OVERRIDE);
    } else {
      window.localStorage.setItem(STORAGE_KEY_MONTHLY_OVERRIDE, String(Math.round(n * 100) / 100));
    }
  } catch {
    // ignore
  }
}
