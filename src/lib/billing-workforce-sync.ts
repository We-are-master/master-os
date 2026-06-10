import type { YmdBounds } from "@/lib/billing-standalone-period";

export type WorkforceSyncResult = { count: number; ids: string[] };

/** Ensure the open monthly workforce SB-INT draft exists (current month only). */
export async function syncWorkforceSelfBillsForBilling(
  _periodBounds: YmdBounds | null,
): Promise<WorkforceSyncResult> {
  const res = await fetch("/api/workforce/sync-self-bills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
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
