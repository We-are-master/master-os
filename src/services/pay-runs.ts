import { getSupabase } from "./base";
import type { PayRun, PayRunItem } from "@/types/database";

/** Get week bounds (Monday–Sunday) for a given date. */
export function getWeekBounds(date: Date): { week_start: string; week_end: string } {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    week_start: monday.toISOString().split("T")[0],
    week_end: sunday.toISOString().split("T")[0],
  };
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

/** Aggregate items due in the week: approved commission_run items (payroll), ready_to_pay self_bills, approved bills. */
export async function loadItemsForWeek(weekStart: string, weekEnd: string): Promise<{
  payroll: { id: string; label: string; amount: number; due_date?: string }[];
  selfBills: { id: string; label: string; amount: number; due_date?: string }[];
  bills: { id: string; label: string; amount: number; due_date: string }[];
}> {
  const supabase = getSupabase();

  const payroll: { id: string; label: string; amount: number; due_date?: string }[] = [];
  const { data: approvedRuns } = await supabase
    .from("commission_runs")
    .select("id")
    .eq("status", "approved");
  if (approvedRuns?.length) {
    for (const run of approvedRuns) {
      const { data: items } = await supabase
        .from("commission_run_items")
        .select("id, commission_amount, team_members(full_name)")
        .eq("commission_run_id", run.id);
      for (const row of items ?? []) {
        const r = row as { id: string; commission_amount: number; team_members: { full_name: string } | { full_name: string }[] | null };
        const amt = Number(r.commission_amount);
        const tm = r.team_members;
        const name = Array.isArray(tm) ? tm[0]?.full_name : tm?.full_name;
        payroll.push({ id: r.id, label: `Commission: ${name ?? "Payroll"}`, amount: amt });
      }
    }
  }

  const { data: selfBillsRows } = await supabase
    .from("self_bills")
    .select("id, partner_name, net_payout, created_at")
    .in("status", ["ready_to_pay", "awaiting_payment"]);
  const selfBills = (selfBillsRows ?? []).map((r: { id: string; partner_name: string; net_payout: number }) => ({
    id: r.id,
    label: r.partner_name,
    amount: Number(r.net_payout),
    due_date: undefined,
  }));

  const { data: billsRows } = await supabase
    .from("bills")
    .select("id, description, amount, due_date")
    .eq("status", "approved")
    .is("archived_at", null)
    .gte("due_date", weekStart)
    .lte("due_date", weekEnd);
  const bills = (billsRows ?? []).map((r: { id: string; description: string; amount: number; due_date: string }) => ({
    id: r.id,
    label: r.description,
    amount: Number(r.amount),
    due_date: r.due_date,
  }));

  return { payroll, selfBills, bills };
}

/** Remove bill lines from any pay run when those bills are archived (stale rows). */
export async function removeBillIdsFromPayRunItems(billIds: string[]): Promise<void> {
  if (billIds.length === 0) return;
  const supabase = getSupabase();
  for (const sourceId of billIds) {
    const { error } = await supabase
      .from("pay_run_items")
      .delete()
      .eq("item_type", "bill")
      .eq("source_id", sourceId);
    if (error) throw error;
  }
}

/** Create pay_run_items for the week with labels. */
export async function buildPayRunItems(payRunId: string, weekStart: string, weekEnd: string): Promise<void> {
  const supabase = getSupabase();
  const { payroll, selfBills, bills } = await loadItemsForWeek(weekStart, weekEnd);

  const toInsert: { pay_run_id: string; item_type: "payroll" | "self_bill" | "bill"; source_id: string; source_label: string; amount: number; due_date: string | null; status: string }[] = [];

  for (const p of payroll) {
    toInsert.push({ pay_run_id: payRunId, item_type: "payroll", source_id: p.id, source_label: p.label, amount: p.amount, due_date: weekStart, status: "pending" });
  }
  for (const s of selfBills) {
    toInsert.push({ pay_run_id: payRunId, item_type: "self_bill", source_id: s.id, source_label: s.label, amount: s.amount, due_date: null, status: "pending" });
  }
  for (const b of bills) {
    toInsert.push({ pay_run_id: payRunId, item_type: "bill", source_id: b.id, source_label: b.label, amount: b.amount, due_date: b.due_date, status: "pending" });
  }

  const existing = await getSupabase().from("pay_run_items").select("id").eq("pay_run_id", payRunId);
  if ((existing.data ?? []).length > 0) return;

  if (toInsert.length > 0) {
    await supabase.from("pay_run_items").insert(toInsert);
  }
}

export async function markPayRunItemsPaid(itemIds: string[]): Promise<void> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data: items } = await supabase.from("pay_run_items").select("id, item_type, source_id").in("id", itemIds);
  if (!items?.length) return;

  for (const item of items as PayRunItem[]) {
    await supabase.from("pay_run_items").update({ status: "paid", paid_at: now }).eq("id", item.id);

    if (item.item_type === "self_bill") {
      await supabase.from("self_bills").update({ status: "paid" }).eq("id", item.source_id);
    } else if (item.item_type === "bill") {
      await supabase.from("bills").update({ status: "paid", paid_at: now }).eq("id", item.source_id);
    }
  }
}

export function exportPayRunToCsv(items: PayRunItem[], weekStart: string, weekEnd: string): string {
  const headers = ["Type", "Source ID", "Amount", "Due Date", "Status"];
  const rows = items.map((i) => [i.item_type, i.source_id, i.amount, i.due_date ?? "", i.status]);
  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  return csv;
}
