/** Browser-only: which commission tier number drives Overview sales goal (no DB column). */

const STORAGE_KEY = "master-os-dashboard-sales-goal-tier-number";

export function getDashboardSalesGoalTierNumberPreference(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)?.trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.floor(n);
  } catch {
    return null;
  }
}

export function setDashboardSalesGoalTierNumberPreference(n: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (n == null || !Number.isFinite(n) || n < 1) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, String(Math.floor(n)));
    }
  } catch {
    // ignore quota / private mode
  }
}
