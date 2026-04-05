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

  const toDelete = existing.filter((r) => r.status === "pending" && !desiredKeys.has(itemKey(r.item_type, r.source_id))).map((r) => r.id);
  if (toDelete.length > 0) {
    const { error: delErr } = await supabase.from("pay_run_items").delete().in("id", toDelete);
    if (delErr) throw delErr;
  }

  const refreshed = (await supabase.from("pay_run_items").select("*").eq("pay_run_id", payRunId)).data as PayRunItem[] | null;
  const afterDelete = refreshed ?? [];

  for (const d of desired) {
    const pending = afterDelete.find(
      (r) => r.status === "pending" && r.item_type === d.item_type && r.source_id === d.source_id,
    );
    const alreadyPaidHere = afterDelete.some(
      (r) => r.status === "paid" && r.item_type === d.item_type && r.source_id === d.source_id,
    );
    if (alreadyPaidHere) continue;

    if (pending) {
      const { error: upErr } = await supabase
        .from("pay_run_items")
        .update({
          amount: d.amount,
          due_date: d.due_date,
          source_label: d.source_label,
        })
        .eq("id", pending.id);
      if (upErr) throw upErr;
    } else {
      const { error: insErr } = await supabase.from("pay_run_items").insert({
        pay_run_id: payRunId,
        item_type: d.item_type,
        source_id: d.source_id,
        source_label: d.source_label,
        amount: d.amount,
        due_date: d.due_date,
        status: "pending",
      });
      if (insErr) throw insErr;
    }
  }
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

  for (const item of items as PayRunItem[]) {
    const { error: u0 } = await supabase.from("pay_run_items").update({ status: "paid", paid_at: now }).eq("id", item.id);
    if (u0) throw u0;

    if (item.item_type === "self_bill") {
      const resPaid = await supabase
        .from("self_bills")
        .update({ status: "paid", paid_at: paidDay })
        .eq("id", item.source_id);
      if (resPaid.error && /paid_at|column|schema|PGRST204/i.test(String(resPaid.error.message ?? ""))) {
        const { error: e2 } = await supabase.from("self_bills").update({ status: "paid" }).eq("id", item.source_id);
        if (e2) throw e2;
      } else if (resPaid.error) {
        throw resPaid.error;
      }
    } else if (item.item_type === "bill") {
      const { error: e3 } = await supabase
        .from("bills")
        .update({ status: "paid", paid_at: paidDay, updated_at: now })
        .eq("id", item.source_id);
      if (e3) throw e3;
    } else if (item.item_type === "internal_cost") {
      const { error: e4 } = await supabase
        .from("payroll_internal_costs")
        .update({ status: "paid", paid_at: paidDay, updated_at: now })
        .eq("id", item.source_id);
      if (e4) throw e4;
    }
  }
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
