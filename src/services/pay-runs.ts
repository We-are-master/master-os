import { getSupabase } from "./base";
import type { PayRun, PayRunItem } from "@/types/database";
import { getWeekBoundsForDate, partnerFieldSelfBillPaymentDueDate } from "@/lib/self-bill-period";
import { isPostgrestSelectSchemaError } from "@/lib/postgrest-errors";

/** Get week bounds (Monday–Sunday, local calendar) for a given date — matches Finance week UI / due_date filters. */
export function getWeekBounds(date: Date): { week_start: string; week_end: string } {
  const { weekStart, weekEnd } = getWeekBoundsForDate(date);
  return { week_start: weekStart, week_end: weekEnd };
}

export async function getOrCreatePayRun(weekStart: string, weekEnd: string): Promise<PayRun> {
  const supabase = getSupabase();
  const { data: existing } = await supabase.from("pay_runs").select("*").eq("week_start", weekStart).maybeSingle();
  if (existing) return existing as PayRun;

  const { data: created, error } = await supabase
    .from("pay_runs")
    .insert({ week_start: weekStart, week_end: weekEnd, status: "open" })
    .select()
    .single();
  if (error) throw error;
  return created as PayRun;
}

export async function getPayRunWithItems(payRunId: string): Promise<PayRunItem[]> {
  const { data, error } = await getSupabase()
    .from("pay_run_items")
    .select("*")
    .eq("pay_run_id", payRunId)
    .order("item_type")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as PayRunItem[];
}

/** Separates display name from reference in `pay_run_items.source_label` (no DB migration). */
export const PAY_RUN_LABEL_SEP = "|||";

export function encodePayRunLabel(displayName: string, reference: string): string {
  const n = (displayName || "—").replace(/\|/g, "/");
  const r = (reference || "—").replace(/\|/g, "/");
  return `${n}${PAY_RUN_LABEL_SEP}${r}`;
}

export function decodePayRunLabel(sourceLabel: string | null | undefined): { name: string; reference: string } {
  const s = sourceLabel ?? "";
  const i = s.indexOf(PAY_RUN_LABEL_SEP);
  if (i < 0) return { name: s || "—", reference: "—" };
  return {
    name: s.slice(0, i).trim() || "—",
    reference: s.slice(i + PAY_RUN_LABEL_SEP.length).trim() || "—",
  };
}

/** Partner field self-bills that are in finance review / payable, not internal workforce bills. */
const PARTNER_SELF_BILL_STATUSES = [
  "ready_to_pay",
  "awaiting_payment",
  "pending_review",
  "needs_attention",
  "audit_required",
] as const;

type SelfBillRow = {
  id: string;
  reference: string;
  partner_name: string;
  net_payout: number;
  week_start?: string | null;
  week_end?: string | null;
  created_at: string;
  bill_origin?: string | null;
};

export type PayRunDesiredLine = {
  item_type: "self_bill" | "internal_cost" | "bill";
  source_id: string;
  source_label: string;
  amount: number;
  due_date: string | null;
};

/**
 * Unpaid lines due in the selected week only — source of truth from modules (no extra financial layer).
 * Partner = field self-bills for that ISO week; Workforce = payroll_internal_costs with due_date in week; Bills = approved supplier bills due in week.
 */
export async function loadPayRunDesiredLines(weekStart: string, weekEnd: string): Promise<PayRunDesiredLine[]> {
  const supabase = getSupabase();
  const out: PayRunDesiredLine[] = [];

  const sbSelectWithOrigin =
    "id, reference, partner_name, net_payout, week_start, week_end, created_at, bill_origin";
  const sbSelectBase =
    "id, reference, partner_name, net_payout, week_start, week_end, created_at";
  const sbStatuses = [...PARTNER_SELF_BILL_STATUSES];

  /** Partner field self-bills only (exclude workforce `bill_origin=internal`). Retries if `bill_origin` is missing on older DBs. */
  async function fetchPartnerSelfBillsChunk(opts: { mode: "week_match" | "legacy_created" }): Promise<SelfBillRow[]> {
    const baseQuery = (selectList: string) => {
      let q = supabase.from("self_bills").select(selectList).in("status", sbStatuses).gt("net_payout", 0.02);
      if (opts.mode === "week_match") {
        q = q.eq("week_start", weekStart);
      } else {
        q = q
          .is("week_start", null)
          .gte("created_at", `${weekStart}T00:00:00.000Z`)
          .lte("created_at", `${weekEnd}T23:59:59.999Z`);
      }
      return q;
    };

    let { data, error } = await baseQuery(sbSelectWithOrigin).or("bill_origin.eq.partner,bill_origin.is.null");

    if (error && isPostgrestSelectSchemaError(error)) {
      ({ data, error } = await baseQuery(sbSelectBase));
    }
    if (error) throw error;

    const rows = (data ?? []) as unknown as SelfBillRow[];
    return rows.filter((r) => (r as { bill_origin?: string | null }).bill_origin !== "internal");
  }

  const sbWeek = await fetchPartnerSelfBillsChunk({ mode: "week_match" });
  const sbLegacy = await fetchPartnerSelfBillsChunk({ mode: "legacy_created" });

  const seenSb = new Set<string>();
  for (const r of [...sbWeek, ...sbLegacy] as SelfBillRow[]) {
    if (seenSb.has(r.id)) continue;
    seenSb.add(r.id);
    const net = Number(r.net_payout) || 0;
    if (net <= 0.02) continue;
    const weekEndYmd = (r.week_end && r.week_end.trim()) || weekEnd;
    out.push({
      item_type: "self_bill",
      source_id: r.id,
      source_label: encodePayRunLabel(r.partner_name?.trim() || "Partner", r.reference?.trim() || "—"),
      amount: net,
      due_date: partnerFieldSelfBillPaymentDueDate(weekEndYmd),
    });
  }

  const payrollSelectFull = "id, payee_name, description, amount, due_date, status";
  const payrollSelectBase = "id, description, amount, due_date, status";

  type PayrollFetchRow = {
    id: string;
    payee_name?: string | null;
    description: string;
    amount: number;
    due_date: string | null;
  };

  let internalRows: PayrollFetchRow[] | null = null;
  const rPay1 = await supabase
    .from("payroll_internal_costs")
    .select(payrollSelectFull)
    .eq("status", "pending")
    .not("due_date", "is", null)
    .gte("due_date", weekStart)
    .lte("due_date", weekEnd)
    .gt("amount", 0);
  let internalErr = rPay1.error;
  internalRows = (rPay1.data ?? null) as PayrollFetchRow[] | null;

  if (internalErr && isPostgrestSelectSchemaError(internalErr)) {
    const rPay2 = await supabase
      .from("payroll_internal_costs")
      .select(payrollSelectBase)
      .eq("status", "pending")
      .not("due_date", "is", null)
      .gte("due_date", weekStart)
      .lte("due_date", weekEnd)
      .gt("amount", 0);
    internalErr = rPay2.error;
    internalRows = (rPay2.data ?? null) as PayrollFetchRow[] | null;
  }
  if (internalErr && isPostgrestSelectSchemaError(internalErr)) {
    const rPay3 = await supabase
      .from("payroll_internal_costs")
      .select(payrollSelectBase)
      .eq("status", "pending")
      .gte("due_date", weekStart)
      .lte("due_date", weekEnd);
    internalErr = rPay3.error;
    internalRows = (rPay3.data ?? null) as PayrollFetchRow[] | null;
  }
  if (internalErr) throw internalErr;

  const payrollFiltered = (internalRows ?? []).filter((r) => {
    const row = r as { amount?: number; due_date?: string | null };
    if (row.due_date == null || String(row.due_date).trim() === "") return false;
    if (Number(row.amount ?? 0) <= 0) return false;
    return true;
  });

  for (const r of payrollFiltered) {
    const row = r as {
      id: string;
      payee_name?: string | null;
      description: string;
      amount: number;
      due_date: string;
    };
    const name = row.payee_name?.trim() || row.description || "Workforce";
    const ref = row.description?.trim() || "—";
    out.push({
      item_type: "internal_cost",
      source_id: row.id,
      source_label: encodePayRunLabel(name, ref),
      amount: Number(row.amount) || 0,
      due_date: row.due_date,
    });
  }

  type BillFetchRow = {
    id: string;
    description: string;
    amount: number;
    due_date: string;
    archived_at?: string | null;
  };

  const rBill1 = await supabase
    .from("bills")
    .select("id, description, amount, due_date, archived_at")
    .eq("status", "approved")
    .is("archived_at", null)
    .gte("due_date", weekStart)
    .lte("due_date", weekEnd)
    .gt("amount", 0);
  let billsErr = rBill1.error;
  let billsRows = (rBill1.data ?? null) as BillFetchRow[] | null;

  if (billsErr && isPostgrestSelectSchemaError(billsErr)) {
    const rBill2 = await supabase
      .from("bills")
      .select("id, description, amount, due_date")
      .eq("status", "approved")
      .gte("due_date", weekStart)
      .lte("due_date", weekEnd)
      .gt("amount", 0);
    billsErr = rBill2.error;
    billsRows = (rBill2.data ?? null) as BillFetchRow[] | null;
  }
  if (billsErr && isPostgrestSelectSchemaError(billsErr)) {
    const rBill3 = await supabase
      .from("bills")
      .select("id, description, amount, due_date")
      .eq("status", "approved")
      .gte("due_date", weekStart)
      .lte("due_date", weekEnd);
    billsErr = rBill3.error;
    billsRows = (rBill3.data ?? null) as BillFetchRow[] | null;
  }
  if (billsErr) throw billsErr;

  const billsFiltered = (billsRows ?? []).filter((r) => {
    const row = r as { amount?: number; archived_at?: string | null };
    if (Number(row.amount ?? 0) <= 0) return false;
    if (row.archived_at) return false;
    return true;
  });

  for (const r of billsFiltered) {
    const row = r as { id: string; description: string; amount: number; due_date: string };
    const desc = row.description?.trim() || "Bill";
    out.push({
      item_type: "bill",
      source_id: row.id,
      source_label: encodePayRunLabel(desc.slice(0, 120), `ID ${row.id.slice(0, 8)}`),
      amount: Number(row.amount) || 0,
      due_date: row.due_date,
    });
  }

  return out;
}

function itemKey(itemType: string, sourceId: string): string {
  return `${itemType}:${sourceId}`;
}

/**
 * Keeps `pay_run_items` aligned with real unpaid rows for the week: upsert pending lines, drop stale pending, never delete paid rows.
 */
export async function syncPayRunItems(payRunId: string, weekStart: string, weekEnd: string): Promise<void> {
  const supabase = getSupabase();
  const desired = await loadPayRunDesiredLines(weekStart, weekEnd);
  const desiredKeys = new Set(desired.map((d) => itemKey(d.item_type, d.source_id)));

  const { data: existingRows, error: exErr } = await supabase.from("pay_run_items").select("*").eq("pay_run_id", payRunId);
  if (exErr) throw exErr;
  const existing = (existingRows ?? []) as PayRunItem[];

  const toDeleteIds = existing
    .filter((r) => r.status === "pending" && !desiredKeys.has(itemKey(r.item_type, r.source_id)))
    .map((r) => r.id);
  if (toDeleteIds.length > 0) {
    const { error: delErr } = await supabase.from("pay_run_items").delete().in("id", toDeleteIds);
    if (delErr) throw delErr;
  }

  /** Compute the post-delete view from in-memory state — saves a full table refetch. */
  const deletedIds = new Set(toDeleteIds);
  const afterDelete = existing.filter((r) => !deletedIds.has(r.id));

  /** Build per-pending update list and per-insert list, then dispatch them in parallel. */
  const updates: Array<{ id: string; amount: number; due_date: string | null; source_label: string }> = [];
  const inserts: Array<{
    pay_run_id: string;
    item_type: PayRunItem["item_type"];
    source_id: string;
    source_label: string;
    amount: number;
    due_date: string | null;
    status: "pending";
  }> = [];

  for (const d of desired) {
    if (afterDelete.some(
      (r) => r.status === "paid" && r.item_type === d.item_type && r.source_id === d.source_id,
    )) continue;
    const pending = afterDelete.find(
      (r) => r.status === "pending" && r.item_type === d.item_type && r.source_id === d.source_id,
    );
    if (pending) {
      updates.push({
        id: pending.id,
        amount: d.amount,
        due_date: d.due_date,
        source_label: d.source_label,
      });
    } else {
      inserts.push({
        pay_run_id: payRunId,
        item_type: d.item_type,
        source_id: d.source_id,
        source_label: d.source_label,
        amount: d.amount,
        due_date: d.due_date,
        status: "pending",
      });
    }
  }

  /** Pending updates have per-row values (different amount/due_date), so we still need one PATCH per row,
   *  but they're all independent — run in parallel via Promise.all. Inserts can be a single bulk INSERT. */
  const tasks: Promise<unknown>[] = [];
  if (inserts.length > 0) {
    tasks.push(
      Promise.resolve(supabase.from("pay_run_items").insert(inserts)).then(({ error }) => { if (error) throw error; }),
    );
  }
  for (const u of updates) {
    tasks.push(
      Promise.resolve(
        supabase
          .from("pay_run_items")
          .update({ amount: u.amount, due_date: u.due_date, source_label: u.source_label })
          .eq("id", u.id),
      ).then(({ error }) => { if (error) throw error; }),
    );
  }
  if (tasks.length > 0) await Promise.all(tasks);
}

/** @deprecated Use loadPayRunDesiredLines — kept for any external callers. */
export async function loadItemsForWeek(
  weekStart: string,
  weekEnd: string,
): Promise<{
  payroll: { id: string; label: string; amount: number; due_date?: string }[];
  internalSalary: { id: string; label: string; amount: number; due_date: string }[];
  selfBills: { id: string; label: string; amount: number; due_date?: string }[];
  bills: { id: string; label: string; amount: number; due_date: string }[];
}> {
  const lines = await loadPayRunDesiredLines(weekStart, weekEnd);
  const payroll: { id: string; label: string; amount: number; due_date?: string }[] = [];
  const internalSalary: { id: string; label: string; amount: number; due_date: string }[] = [];
  const selfBills: { id: string; label: string; amount: number; due_date?: string }[] = [];
  const bills: { id: string; label: string; amount: number; due_date: string }[] = [];
  for (const d of lines) {
    const dec = decodePayRunLabel(d.source_label);
    if (d.item_type === "internal_cost" && d.due_date) {
      internalSalary.push({ id: d.source_id, label: dec.name, amount: d.amount, due_date: d.due_date });
    } else if (d.item_type === "self_bill") {
      selfBills.push({ id: d.source_id, label: dec.name, amount: d.amount, due_date: d.due_date ?? undefined });
    } else if (d.item_type === "bill" && d.due_date) {
      bills.push({ id: d.source_id, label: dec.name, amount: d.amount, due_date: d.due_date });
    }
  }
  return { payroll, internalSalary, selfBills, bills };
}

/** @deprecated Alias for syncPayRunItems */
export async function buildPayRunItems(payRunId: string, weekStart: string, weekEnd: string): Promise<void> {
  await syncPayRunItems(payRunId, weekStart, weekEnd);
}

/** Remove bill lines from any pay run when those bills are archived (stale rows). */
export async function removeBillIdsFromPayRunItems(billIds: string[]): Promise<void> {
  if (billIds.length === 0) return;
  const { error } = await getSupabase()
    .from("pay_run_items")
    .delete()
    .eq("item_type", "bill")
    .in("source_id", billIds);
  if (error) throw error;
}

export async function markPayRunItemsPaid(itemIds: string[]): Promise<void> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const paidDay = now.split("T")[0];

  const { data: items } = await supabase.from("pay_run_items").select("id, item_type, source_id").in("id", itemIds);
  if (!items?.length) return;

  /** Group source ids by item_type so each downstream table gets ONE bulk update instead of N. */
  const selfBillIds: string[] = [];
  const billIds: string[] = [];
  const internalCostIds: string[] = [];
  const lineIds: string[] = [];
  for (const item of items as PayRunItem[]) {
    lineIds.push(item.id);
    if (item.item_type === "self_bill") selfBillIds.push(item.source_id);
    else if (item.item_type === "bill") billIds.push(item.source_id);
    else if (item.item_type === "internal_cost") internalCostIds.push(item.source_id);
  }

  /** Self-bill bulk update — keep the legacy paid_at-missing fallback (some prod DBs lack the column). */
  const updateSelfBillsBulk = async () => {
    if (selfBillIds.length === 0) return;
    const res = await supabase
      .from("self_bills")
      .update({ status: "paid", paid_at: paidDay })
      .in("id", selfBillIds);
    if (res.error && /paid_at|column|schema|PGRST204/i.test(String(res.error.message ?? ""))) {
      const { error } = await supabase.from("self_bills").update({ status: "paid" }).in("id", selfBillIds);
      if (error) throw error;
    } else if (res.error) {
      throw res.error;
    }
  };

  /** All four bulk updates are independent — fan them out in parallel. */
  await Promise.all([
    supabase
      .from("pay_run_items")
      .update({ status: "paid", paid_at: now })
      .in("id", lineIds)
      .then(({ error }) => { if (error) throw error; }),
    updateSelfBillsBulk(),
    billIds.length === 0
      ? Promise.resolve()
      : supabase
          .from("bills")
          .update({ status: "paid", paid_at: paidDay, updated_at: now })
          .in("id", billIds)
          .then(({ error }) => { if (error) throw error; }),
    internalCostIds.length === 0
      ? Promise.resolve()
      : supabase
          .from("payroll_internal_costs")
          .update({ status: "paid", paid_at: paidDay, updated_at: now })
          .in("id", internalCostIds)
          .then(({ error }) => { if (error) throw error; }),
  ]);
}

/** Partner self-bill states shown as “Draft” in Pay Run (not yet cleared for payout). */
const PAY_RUN_DRAFT_SELF_BILL_STATUSES = new Set([
  "draft",
  "accumulating",
  "pending_review",
  "needs_attention",
  "audit_required",
]);

export type PayRunQueueBucket = "draft" | "approved_to_pay" | "paid";

/**
 * Classifies a pay-run line for UI filters. Workforce/bills only enter the run when already approved,
 * so they map to **approved_to_pay** while unpaid. Partner lines follow `self_bills.status`.
 */
export function payRunQueueBucket(item: PayRunItem, selfBillStatus?: string | null): PayRunQueueBucket {
  if (item.status === "paid") return "paid";
  if (item.item_type !== "self_bill") return "approved_to_pay";
  const s = (selfBillStatus ?? "").trim();
  if (PAY_RUN_DRAFT_SELF_BILL_STATUSES.has(s)) return "draft";
  return "approved_to_pay";
}

/** Load current `self_bills.status` for partner lines (for Draft vs Approved to pay). */
export async function fetchSelfBillStatusesByIds(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.map((x) => x.trim()).filter(Boolean))];
  if (unique.length === 0) return {};
  const supabase = getSupabase();
  const { data, error } = await supabase.from("self_bills").select("id,status").in("id", unique);
  if (error) throw error;
  const m: Record<string, string> = {};
  for (const row of data ?? []) {
    const r = row as { id: string; status: string };
    m[r.id] = r.status;
  }
  return m;
}

export function payRunItemTypeLabel(itemType: PayRunItem["item_type"]): string {
  switch (itemType) {
    case "self_bill":
      return "Partner";
    case "internal_cost":
      return "Workforce";
    case "bill":
      return "Bill";
    case "payroll":
      return "Commission";
    default: {
      const x = itemType as string;
      return x.replace(/_/g, " ");
    }
  }
}

export function exportPayRunToCsv(items: PayRunItem[], weekStart: string, weekEnd: string): string {
  const headers = ["Type", "Name", "Reference", "Amount due", "Due date", "Status"];
  const rows = items.map((i) => {
    const { name, reference } = decodePayRunLabel(i.source_label);
    return [
      payRunItemTypeLabel(i.item_type),
      name,
      reference,
      String(i.amount),
      i.due_date ?? "",
      i.status,
    ];
  });
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  return `Week ${weekStart}–${weekEnd}\n${csv}`;
}
