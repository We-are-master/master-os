import { getSupabase } from "@/services/base";
import { partnerSelfBillGrossAmount } from "@/lib/job-financials";
import {
  cancelSelfBillsByIds,
  isSelfBillPayoutVoided,
  jobContributesToSelfBillPayout,
  listJobsLinkedToSelfBillIds,
} from "@/services/self-bills";
import { selfBillWisePayAmount } from "@/lib/self-bill-payment-plan";
import type { Job, SelfBill, SelfBillPaymentInstallment } from "@/types/database";

const JOB_PAYMENTS_IN_CHUNK = 80;

export type SelfBillJobLine = Pick<
  Job,
  | "id"
  | "reference"
  | "title"
  | "partner_cost"
  | "partner_agreed_value"
  | "materials_cost"
  | "status"
  | "property_address"
  | "self_bill_id"
  | "deleted_at"
  | "partner_cancelled_at"
  | "billed_hours"
>;

export async function markSelfBillsPaid(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const supabase = getSupabase();
  const paidDay = new Date().toISOString().slice(0, 10);
  const res = await supabase.from("self_bills").update({ status: "paid", paid_at: paidDay }).in("id", ids);
  if (res.error && /paid_at|column|schema|PGRST204/i.test(String(res.error.message ?? ""))) {
    const { error } = await supabase.from("self_bills").update({ status: "paid" }).in("id", ids);
    if (error) throw error;
  } else if (res.error) {
    throw res.error;
  }
}

export async function fetchPartnerPaidTotalsByJobIds(jobIds: string[]): Promise<Record<string, number>> {
  if (jobIds.length === 0) return {};
  const supabase = getSupabase();
  const sums: Record<string, number> = {};
  for (let i = 0; i < jobIds.length; i += JOB_PAYMENTS_IN_CHUNK) {
    const chunk = jobIds.slice(i, i + JOB_PAYMENTS_IN_CHUNK);
    let { data, error } = await supabase
      .from("job_payments")
      .select("job_id, amount")
      .eq("type", "partner")
      .in("job_id", chunk)
      .is("deleted_at", null);
    if (error) {
      const retry = await supabase.from("job_payments").select("job_id, amount").eq("type", "partner").in("job_id", chunk);
      data = retry.data;
      error = retry.error;
    }
    if (error) throw error;
    for (const row of data ?? []) {
      const id = String((row as { job_id: string }).job_id);
      sums[id] = (sums[id] ?? 0) + Number((row as { amount: number }).amount);
    }
  }
  return sums;
}

function jobLinePartnerGross(j: Pick<Job, "partner_cost" | "materials_cost" | "partner_agreed_value">): number {
  return Math.round(partnerSelfBillGrossAmount(j as Job) * 100) / 100;
}

export function computeSelfBillAmountDue(
  sb: SelfBill,
  jobs: SelfBillJobLine[] | undefined,
  partnerPaidByJobId: Record<string, number>,
  installments?: SelfBillPaymentInstallment[] | null,
): number {
  if (isSelfBillPayoutVoided(sb)) return 0;
  let base = 0;
  if (sb.bill_origin === "internal") {
    base = Math.max(0, Math.round(Number(sb.net_payout ?? 0) * 100) / 100);
  } else {
    const list = jobs ?? [];
    if (list.length === 0) {
      base = Math.max(0, Math.round(Number(sb.net_payout ?? 0) * 100) / 100);
    } else {
      let due = 0;
      for (const j of list) {
        if (!jobContributesToSelfBillPayout(j)) continue;
        const cap = jobLinePartnerGross(j);
        const paid = partnerPaidByJobId[j.id] ?? 0;
        due += Math.max(0, cap - paid);
      }
      base = Math.round(due * 100) / 100;
    }
  }
  return selfBillWisePayAmount(sb, installments, base);
}

export async function computeLinkedJobsMapsForSelfBillIds(ids: string[]): Promise<{
  map: Record<string, SelfBillJobLine[]>;
  partnerPaidByJobId: Record<string, number>;
}> {
  if (ids.length === 0) return { map: {}, partnerPaidByJobId: {} };
  const rows = await listJobsLinkedToSelfBillIds(ids);
  const map: Record<string, SelfBillJobLine[]> = {};
  for (const j of rows) {
    const sid = j.self_bill_id as string;
    if (!map[sid]) map[sid] = [];
    map[sid].push(j as SelfBillJobLine);
  }
  const jobIds = [...new Set(rows.map((r) => r.id))];
  const partnerPaidByJobId = await fetchPartnerPaidTotalsByJobIds(jobIds);
  return { map, partnerPaidByJobId };
}

export async function bulkCancelSelfBills(ids: string[]): Promise<void> {
  await cancelSelfBillsByIds(ids);
}

export async function bulkApproveSelfBills(
  ids: string[],
): Promise<{ approved: number; skipped: { id: string; reference?: string; reason: string }[] }> {
  const res = await fetch("/api/self-bills/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selfBillIds: ids }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    approved?: number;
    skipped?: { id: string; reference?: string; reason: string }[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? "Failed to approve");
  return { approved: data.approved ?? 0, skipped: data.skipped ?? [] };
}

export async function bulkUnapproveSelfBills(
  ids: string[],
): Promise<{ unapproved: number; skipped: { id: string; reference?: string; reason: string }[] }> {
  const res = await fetch("/api/self-bills/unapprove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selfBillIds: ids }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    unapproved?: number;
    skipped?: { id: string; reference?: string; reason: string }[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? "Failed to unapprove");
  return { unapproved: data.unapproved ?? 0, skipped: data.skipped ?? [] };
}

export async function payWithWise(
  selfBillId: string,
  opts?: { scope?: "full" | "job"; jobId?: string; jobAmount?: number },
): Promise<{
  ok: boolean;
  wise_transfer_id?: string;
  wise_status?: string;
  funded?: boolean;
  error?: string;
}> {
  const res = await fetch("/api/self-bills/wise-pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selfBillId,
      scope: opts?.scope ?? "full",
      jobId: opts?.jobId,
      jobAmount: opts?.jobAmount,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    wise_transfer_id?: string;
    wise_status?: string;
    funded?: boolean;
    error?: string;
  };
  if (!res.ok) return { ok: false, error: data.error ?? "Wise pay failed" };
  return { ok: true, ...data };
}

export async function bulkSendSelfBillEmails(
  ids: string[],
  opts?: { cycleKind?: "standard" | "off_cycle" | "auto"; bundleByPartner?: boolean },
): Promise<{
  sent: number;
  emailsSent: number;
  skipped: { id: string; reference?: string; reason: string }[];
}> {
  const res = await fetch("/api/self-bills/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selfBillIds: ids,
      paymentRunHint: opts?.cycleKind ?? "auto",
      bundleByPartner: opts?.bundleByPartner === true,
    }),
  });
  const data = (await res.json()) as {
    sent?: number;
    emailsSent?: number;
    skipped?: { id: string; reference?: string; reason: string }[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? "Failed to send emails");
  return {
    sent: data.sent ?? 0,
    emailsSent: data.emailsSent ?? data.sent ?? 0,
    skipped: data.skipped ?? [],
  };
}

export function getBulkEligibleSelfBillIds(
  selectedIds: Set<string>,
  selfBills: SelfBill[],
  filteredIdSet: Set<string>,
  opts?: { forEmail?: boolean },
): string[] {
  return Array.from(selectedIds).filter((id) => {
    const sb = selfBills.find((s) => s.id === id);
    if (!sb || !filteredIdSet.has(id) || isSelfBillPayoutVoided(sb)) return false;
    if (opts?.forEmail) {
      if (sb.bill_origin === "internal" || !sb.partner_id?.trim()) return false;
    }
    return true;
  });
}

export function getBulkCancellableSelfBillIds(
  selectedIds: Set<string>,
  selfBills: SelfBill[],
  filteredIdSet: Set<string>,
): string[] {
  return Array.from(selectedIds).filter((id) => {
    const sb = selfBills.find((s) => s.id === id);
    if (!sb || !filteredIdSet.has(id) || isSelfBillPayoutVoided(sb)) return false;
    return sb.status !== "paid";
  });
}
