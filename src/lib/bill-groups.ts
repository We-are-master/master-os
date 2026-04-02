import type { Bill } from "@/types/database";

/** Stable key for grouping pre-generated recurring rows (same batch or fingerprint fallback). */
export function recurringGroupKey(b: Bill): string | null {
  if (!b.is_recurring || !b.recurrence_interval) return null;
  if (b.recurring_series_id) return `s:${b.recurring_series_id}`;
  const desc = (b.description ?? "").trim().toLowerCase();
  const cat = String(b.category ?? "");
  const amt = Number(b.amount);
  return `fp:${desc}|${cat}|${amt}|${b.recurrence_interval}`;
}

export type BillDisplayItem =
  | { type: "series"; key: string; all: Bill[]; visible: Bill[] }
  | { type: "single"; bill: Bill };

function billMatchesStatusFilter(b: Bill, statusFilter: string): boolean {
  if (statusFilter === "all" || statusFilter === "archived") return true;
  return b.status === statusFilter;
}

export function buildBillDisplayList(scopedBills: Bill[], statusFilter: string): BillDisplayItem[] {
  const byKey = new Map<string, Bill[]>();
  const singles: Bill[] = [];

  for (const b of scopedBills) {
    const k = recurringGroupKey(b);
    if (!k) {
      singles.push(b);
      continue;
    }
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(b);
  }

  const items: BillDisplayItem[] = [];

  for (const [key, all] of byKey) {
    const allSorted = [...all].sort((a, b) => a.due_date.localeCompare(b.due_date));
    const visible = allSorted.filter((b) => billMatchesStatusFilter(b, statusFilter));
    if (visible.length === 0) continue;
    items.push({ type: "series", key, all: allSorted, visible });
  }

  for (const b of singles) {
    if (!billMatchesStatusFilter(b, statusFilter)) continue;
    items.push({ type: "single", bill: b });
  }

  items.sort((a, b) => {
    const da = a.type === "series" ? a.visible[0].due_date : a.bill.due_date;
    const db = b.type === "series" ? b.visible[0].due_date : b.bill.due_date;
    return da.localeCompare(db);
  });

  return items;
}
