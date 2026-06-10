import { getBillingInitialFetchBounds } from "@/lib/billing-standalone-filter";
import { addDaysYmd, todayYmdLocal, type YmdBounds } from "@/lib/billing-standalone-period";

/** Billing sync window: selected period, or 12 months back + 90 days ahead (covers pay-day-5 due dates). */
export function resolveWorkforceSyncBoundsForBilling(periodBounds: YmdBounds | null): YmdBounds {
  if (periodBounds) return periodBounds;
  const today = todayYmdLocal();
  return { from: addDaysYmd(today, -365), to: addDaysYmd(today, 90) };
}

export type WorkforceSyncResult = { count: number; ids: string[] };

/** Ensure workforce SB-INT rows exist for the billing fetch window. */
export async function syncWorkforceSelfBillsForBilling(
  periodBounds: YmdBounds | null,
): Promise<WorkforceSyncResult> {
  const bounds = resolveWorkforceSyncBoundsForBilling(periodBounds ?? getBillingInitialFetchBounds());
  const res = await fetch("/api/workforce/sync-self-bills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: bounds.from, to: bounds.to }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    count?: number;
    ids?: string[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(payload.error ?? "Workforce self-bill sync failed");
  }
  return { count: payload.count ?? 0, ids: payload.ids ?? [] };
}
