import { getSupabase } from "./base";
import type { Bill, BillRecurrence, BillStatus } from "@/types/database";
import { recurringGroupKey } from "@/lib/bill-groups";
import { removeBillIdsFromPayRunItems } from "./pay-runs";
import { generateRecurringDueDates, RECURRENCE_GENERATION_COUNTS } from "@/lib/bill-recurrence";

export async function listBills(params?: { status?: string; from?: string; to?: string }): Promise<Bill[]> {
  let q = getSupabase().from("bills").select("*").order("due_date", { ascending: true });
  if (params?.status && params.status !== "all") q = q.eq("status", params.status);
  if (params?.from) q = q.gte("due_date", params.from);
  if (params?.to) q = q.lte("due_date", params.to);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Bill[];
}

export type CreateBillPayload = Omit<Bill, "id" | "created_at" | "updated_at">;

export async function createBill(payload: CreateBillPayload): Promise<Bill> {
  const supabase = getSupabase();
  if (payload.is_recurring && payload.recurrence_interval && payload.due_date) {
    const interval = payload.recurrence_interval;
    const n = RECURRENCE_GENERATION_COUNTS[interval] ?? 12;
    const dueDates = generateRecurringDueDates(payload.due_date, interval, n);
    const recurringSeriesId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const rows = dueDates.map((due_date) => ({
      description: payload.description,
      category: payload.category ?? null,
      amount: payload.amount,
      due_date,
      is_recurring: true,
      recurrence_interval: interval,
      recurring_series_id: recurringSeriesId,
      submitted_by_id: payload.submitted_by_id ?? null,
      submitted_by_name: payload.submitted_by_name ?? null,
      status: (payload.status ?? "submitted") as BillStatus,
      receipt_url: payload.receipt_url ?? null,
    }));
    const { data, error } = await supabase.from("bills").insert(rows).select();
    if (error) throw error;
    const first = (data as Bill[] | null)?.[0];
    if (!first) throw new Error("Failed to create recurring bills");
    return first;
  }

  const { data, error } = await supabase
    .from("bills")
    .insert({
      description: payload.description,
      category: payload.category ?? null,
      amount: payload.amount,
      due_date: payload.due_date,
      is_recurring: payload.is_recurring ?? false,
      recurrence_interval: payload.recurrence_interval ?? null,
      submitted_by_id: payload.submitted_by_id ?? null,
      submitted_by_name: payload.submitted_by_name ?? null,
      status: payload.status ?? "submitted",
      receipt_url: payload.receipt_url ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Bill;
}

export type UpdateBillInput = Partial<
  Pick<
    Bill,
    | "description"
    | "category"
    | "amount"
    | "due_date"
    | "status"
    | "receipt_url"
    | "paid_at"
    | "is_recurring"
    | "archived_at"
  >
> & {
  recurrence_interval?: BillRecurrence | null;
};

export async function updateBill(id: string, updates: UpdateBillInput): Promise<Bill> {
  const { data, error } = await getSupabase()
    .from("bills")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Bill;
}

/**
 * Approve this bill; if it belongs to a recurring series, also approves every other
 * non-archived occurrence still in submitted / needs_attention (same series or fingerprint).
 */
export async function approveBillOrSeries(billId: string): Promise<{ approvedCount: number; bill: Bill }> {
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from("bills").select("*").eq("id", billId).single();
  if (error) throw error;
  const bill = row as Bill;
  const now = new Date().toISOString();

  if (!bill.is_recurring || !bill.recurrence_interval) {
    const { data, error: uErr } = await supabase
      .from("bills")
      .update({ status: "approved" as BillStatus, updated_at: now })
      .eq("id", billId)
      .select()
      .single();
    if (uErr) throw uErr;
    return { approvedCount: 1, bill: data as Bill };
  }

  if (bill.recurring_series_id) {
    const { data: updated, error: uErr } = await supabase
      .from("bills")
      .update({ status: "approved" as BillStatus, updated_at: now })
      .eq("recurring_series_id", bill.recurring_series_id)
      .in("status", ["submitted", "needs_attention"])
      .is("archived_at", null)
      .select("id");
    if (uErr) throw uErr;
    const { data: again, error: fErr } = await supabase.from("bills").select("*").eq("id", billId).single();
    if (fErr) throw fErr;
    return { approvedCount: (updated ?? []).length, bill: again as Bill };
  }

  const { data: candidates, error: cErr } = await supabase
    .from("bills")
    .select("*")
    .eq("is_recurring", true)
    .eq("recurrence_interval", bill.recurrence_interval)
    .is("archived_at", null)
    .in("status", ["submitted", "needs_attention"]);
  if (cErr) throw cErr;
  const key = recurringGroupKey(bill);
  const matchIds = (candidates ?? [])
    .filter((b) => recurringGroupKey(b as Bill) === key)
    .map((b) => (b as Bill).id);
  if (matchIds.length === 0) {
    const { data, error: uErr } = await supabase
      .from("bills")
      .update({ status: "approved" as BillStatus, updated_at: now })
      .eq("id", billId)
      .select()
      .single();
    if (uErr) throw uErr;
    return { approvedCount: 1, bill: data as Bill };
  }
  const { error: bulkErr } = await supabase
    .from("bills")
    .update({ status: "approved" as BillStatus, updated_at: now })
    .in("id", matchIds);
  if (bulkErr) throw bulkErr;
  const { data: again, error: fErr } = await supabase.from("bills").select("*").eq("id", billId).single();
  if (fErr) throw fErr;
  return { approvedCount: matchIds.length, bill: again as Bill };
}

/** Mark paid only — recurring bills are pre-generated; we do not chain the next row from payment. */
export async function markBillPaid(id: string, paidAt?: string): Promise<Bill> {
  const paidDate = paidAt ?? new Date().toISOString().split("T")[0];
  const { data, error } = await getSupabase()
    .from("bills")
    .update({ status: "paid", paid_at: paidDate, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Bill;
}

export async function archiveBillsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from("bills")
    .update({ archived_at: now, updated_at: now })
    .in("id", ids);
  if (error) throw error;
  await removeBillIdsFromPayRunItems(ids);
}
