import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./base";
import { updateSelfBill } from "./self-bills";
import {
  activeSelfBillInstallments,
  nextOpenSelfBillInstallment,
  PAYMENT_PLAN_EPS,
  type PaymentPlanInstallmentDraft,
  validateInstallmentsSum,
} from "@/lib/self-bill-payment-plan";
import { PAYMENT_PLAN_MAX_INSTALLMENTS } from "@/lib/invoice-payment-plan";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";
import type { SelfBill, SelfBillPaymentInstallment } from "@/types/database";

export async function listInstallmentsForSelfBillIds(
  selfBillIds: string[],
  client?: SupabaseClient,
): Promise<Record<string, SelfBillPaymentInstallment[]>> {
  if (selfBillIds.length === 0) return {};
  const supabase = client ?? getSupabase();
  const { data, error } = await supabase
    .from("self_bill_payment_installments")
    .select("*")
    .in("self_bill_id", selfBillIds)
    .order("sequence", { ascending: true });
  if (error) {
    if (isSupabaseMissingColumnError(error)) return {};
    throw error;
  }
  const out: Record<string, SelfBillPaymentInstallment[]> = {};
  for (const row of (data ?? []) as SelfBillPaymentInstallment[]) {
    const list = out[row.self_bill_id] ?? [];
    list.push(row);
    out[row.self_bill_id] = list;
  }
  return out;
}

export async function listInstallmentsForSelfBill(
  selfBillId: string,
): Promise<SelfBillPaymentInstallment[]> {
  const map = await listInstallmentsForSelfBillIds([selfBillId]);
  return map[selfBillId] ?? [];
}

export async function createSelfBillPaymentPlan(
  selfBillId: string,
  netPayout: number,
  drafts: PaymentPlanInstallmentDraft[],
): Promise<SelfBillPaymentInstallment[]> {
  if (drafts.length < 1) throw new Error("At least one installment is required.");
  if (drafts.length > PAYMENT_PLAN_MAX_INSTALLMENTS) {
    throw new Error(`Maximum ${PAYMENT_PLAN_MAX_INSTALLMENTS} installments allowed.`);
  }
  if (!validateInstallmentsSum(netPayout, drafts)) {
    throw new Error("Installment amounts must sum to the net payout.");
  }

  const supabase = getSupabase();
  const rows = drafts.map((d, idx) => ({
    self_bill_id: selfBillId,
    sequence: idx + 1,
    amount: Math.round(Number(d.amount) * 100) / 100,
    due_date: d.due_date.slice(0, 10),
    status: "pending" as const,
  }));

  const { error: delErr } = await supabase
    .from("self_bill_payment_installments")
    .delete()
    .eq("self_bill_id", selfBillId);
  if (delErr && !isSupabaseMissingColumnError(delErr)) throw delErr;

  const { data, error } = await supabase
    .from("self_bill_payment_installments")
    .insert(rows)
    .select();
  if (error) throw error;

  const firstDue = drafts[0]!.due_date.slice(0, 10);
  const { error: sbErr } = await supabase
    .from("self_bills")
    .update({ due_date: firstDue, payment_plan_active: true })
    .eq("id", selfBillId);
  if (sbErr && !isSupabaseMissingColumnError(sbErr)) throw sbErr;

  return (data ?? []) as SelfBillPaymentInstallment[];
}

/** Replace installment rows when none are paid yet. */
export async function updateSelfBillPaymentPlan(
  selfBillId: string,
  netPayout: number,
  drafts: PaymentPlanInstallmentDraft[],
): Promise<SelfBillPaymentInstallment[]> {
  const existing = await listInstallmentsForSelfBill(selfBillId);
  if (existing.some((i) => i.status === "paid")) {
    throw new Error("Cannot edit plan after an installment was paid.");
  }
  return createSelfBillPaymentPlan(selfBillId, netPayout, drafts);
}

export async function cancelSelfBillPaymentPlan(selfBillId: string): Promise<void> {
  const supabase = getSupabase();
  const existing = await listInstallmentsForSelfBill(selfBillId);
  if (existing.some((i) => i.status === "paid")) {
    throw new Error("Cannot cancel plan after an installment was paid.");
  }
  const { error } = await supabase
    .from("self_bill_payment_installments")
    .delete()
    .eq("self_bill_id", selfBillId);
  if (error) throw error;
  const { error: sbErr } = await supabase
    .from("self_bills")
    .update({ payment_plan_active: false })
    .eq("id", selfBillId);
  if (sbErr && !isSupabaseMissingColumnError(sbErr)) throw sbErr;
}

export async function markSelfBillInstallmentPaid(
  installmentId: string,
  sb: SelfBill,
): Promise<{ installments: SelfBillPaymentInstallment[]; selfBill: SelfBill }> {
  const supabase = getSupabase();
  const installments = await listInstallmentsForSelfBill(sb.id);
  const target = installments.find((i) => i.id === installmentId);
  if (!target || target.status !== "pending") {
    throw new Error("Installment not found or already paid.");
  }

  const now = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("self_bill_payment_installments")
    .update({ status: "paid", paid_at: now })
    .eq("id", installmentId);
  if (upErr) throw upErr;

  const updated = await listInstallmentsForSelfBill(sb.id);
  const next = nextOpenSelfBillInstallment(updated);
  const allPaid = !next;

  const patch: Partial<Pick<SelfBill, "status" | "due_date">> = {};
  if (next) patch.due_date = next.due_date.slice(0, 10);
  if (allPaid) patch.status = "paid";

  const selfBill = allPaid
    ? await updateSelfBill(sb.id, patch)
    : patch.due_date
      ? await updateSelfBill(sb.id, { due_date: patch.due_date })
      : sb;

  return { installments: updated, selfBill };
}

export async function markAllSelfBillInstallmentsPaid(
  sb: SelfBill,
): Promise<{ installments: SelfBillPaymentInstallment[]; selfBill: SelfBill }> {
  const supabase = getSupabase();
  const installments = await listInstallmentsForSelfBill(sb.id);
  const pending = activeSelfBillInstallments(installments).filter((i) => i.status === "pending");
  if (pending.length === 0) {
    throw new Error("No pending installments to pay.");
  }

  const now = new Date().toISOString();
  for (const inst of pending) {
    const { error } = await supabase
      .from("self_bill_payment_installments")
      .update({ status: "paid", paid_at: now })
      .eq("id", inst.id);
    if (error) throw error;
  }

  const updated = await listInstallmentsForSelfBill(sb.id);
  const selfBill = await updateSelfBill(sb.id, { status: "paid" });
  return { installments: updated, selfBill };
}

/** Sync installment paid flags + self-bill due_date from cumulative partner paid (FIFO). */
export async function syncSelfBillPaymentPlanFromPartnerPaid(
  selfBillId: string,
  partnerPaidTotal: number,
): Promise<void> {
  const supabase = getSupabase();
  const { data: sbRow, error: sbErr } = await supabase
    .from("self_bills")
    .select("id, payment_plan_active, status, net_payout")
    .eq("id", selfBillId)
    .maybeSingle();
  if (sbErr || !sbRow) return;
  const sb = sbRow as Pick<SelfBill, "id" | "payment_plan_active" | "status" | "net_payout">;
  if (!sb.payment_plan_active) return;

  const installments = await listInstallmentsForSelfBill(selfBillId);
  if (installments.length === 0) return;

  const amountPaid = Math.round(Number(partnerPaidTotal ?? 0) * 100) / 100;
  const netPayout = Math.round(Number(sb.net_payout ?? 0) * 100) / 100;
  let remaining = amountPaid;
  const now = new Date().toISOString();
  const active = activeSelfBillInstallments(installments);

  for (const inst of active) {
    const amt = Math.round(Number(inst.amount ?? 0) * 100) / 100;
    const shouldBePaid = remaining + PAYMENT_PLAN_EPS >= amt;
    if (shouldBePaid && inst.status === "pending") {
      remaining = Math.round((remaining - amt) * 100) / 100;
      await supabase
        .from("self_bill_payment_installments")
        .update({ status: "paid", paid_at: now })
        .eq("id", inst.id);
    } else if (!shouldBePaid && inst.status === "paid") {
      await supabase
        .from("self_bill_payment_installments")
        .update({ status: "pending", paid_at: null })
        .eq("id", inst.id);
    }
  }

  const refreshed = await listInstallmentsForSelfBill(selfBillId);
  const next = nextOpenSelfBillInstallment(refreshed);
  const allPaid = amountPaid + PAYMENT_PLAN_EPS >= netPayout;
  const patch: Record<string, unknown> = {};
  if (next) patch.due_date = next.due_date.slice(0, 10);
  if (allPaid && sb.status !== "paid") patch.status = "paid";
  if (Object.keys(patch).length > 0) {
    await supabase.from("self_bills").update(patch).eq("id", selfBillId);
  }
}

/** After a funded Wise transfer for one installment — advance due_date or close the self-bill. */
export async function applySelfBillWiseInstallmentPayment(
  selfBillId: string,
  installmentId: string,
  opts: { wiseTransferId: string; wiseStatus: string; funded: boolean },
  client?: SupabaseClient,
): Promise<void> {
  const supabase = client ?? getSupabase();
  const now = new Date().toISOString();

  if (opts.funded) {
    const { error: instErr } = await supabase
      .from("self_bill_payment_installments")
      .update({ status: "paid", paid_at: now })
      .eq("id", installmentId);
    if (instErr) throw instErr;
  }

  const installments = await listInstallmentsForSelfBill(selfBillId);
  const next = nextOpenSelfBillInstallment(installments);

  const update: Record<string, unknown> = {
    wise_transfer_id: opts.wiseTransferId,
    wise_status: opts.wiseStatus,
  };

  if (opts.funded) {
    if (next) {
      update.due_date = next.due_date.slice(0, 10);
    } else {
      update.wise_paid_at = now;
      update.paid_at = now;
      update.status = "paid";
    }
  }

  const { error: sbErr } = await supabase.from("self_bills").update(update).eq("id", selfBillId);
  if (sbErr) throw sbErr;
}
