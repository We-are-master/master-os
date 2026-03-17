import { getSupabase } from "./base";
import type { Bill } from "@/types/database";

export async function listBills(params?: { status?: string; from?: string; to?: string }): Promise<Bill[]> {
  let q = getSupabase().from("bills").select("*").order("due_date", { ascending: true });
  if (params?.status && params.status !== "all") q = q.eq("status", params.status);
  if (params?.from) q = q.gte("due_date", params.from);
  if (params?.to) q = q.lte("due_date", params.to);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Bill[];
}

export async function createBill(
  payload: Omit<Bill, "id" | "created_at" | "updated_at">
): Promise<Bill> {
  const { data, error } = await getSupabase()
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

export async function updateBill(
  id: string,
  updates: Partial<Pick<Bill, "description" | "category" | "amount" | "due_date" | "status" | "receipt_url" | "paid_at">>
): Promise<Bill> {
  const { data, error } = await getSupabase()
    .from("bills")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Bill;
}

/** When marking a recurring bill as paid, create the next occurrence. */
export async function markBillPaid(id: string, paidAt?: string): Promise<Bill> {
  const supabase = getSupabase();
  const { data: bill, error: fetchErr } = await supabase.from("bills").select("*").eq("id", id).single();
  if (fetchErr || !bill) throw new Error("Bill not found");

  const paidDate = paidAt ?? new Date().toISOString().split("T")[0];
  const { data: updated, error: updateErr } = await supabase
    .from("bills")
    .update({ status: "paid", paid_at: paidDate, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (updateErr) throw updateErr;

  if (bill.is_recurring && bill.recurrence_interval) {
    const nextDue = nextDueDate(bill.due_date, bill.recurrence_interval);
    await supabase.from("bills").insert({
      description: bill.description,
      category: bill.category,
      amount: bill.amount,
      due_date: nextDue,
      is_recurring: true,
      recurrence_interval: bill.recurrence_interval,
      submitted_by_id: bill.submitted_by_id,
      submitted_by_name: bill.submitted_by_name,
      status: "submitted",
      parent_bill_id: id,
    });
  }
  return updated as Bill;
}

function nextDueDate(current: string, interval: string): string {
  const d = new Date(current);
  if (interval === "monthly") d.setMonth(d.getMonth() + 1);
  else if (interval === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (interval === "yearly") d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split("T")[0];
}
