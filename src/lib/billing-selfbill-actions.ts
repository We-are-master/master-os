import { getSupabase } from "@/services/base";
import { partnerSelfBillGrossAmount } from "@/lib/job-financials";
import { officeCancellationPartnerPayoutGbp } from "@/lib/job-cancel-economics";
import {
  cancelSelfBillsByIds,
  isSelfBillPayoutVoided,
  jobContributesToSelfBillPayout,
  listJobsLinkedToSelfBillIds,
  listVisitPayoutLinesBySelfBillId,
  type SelfBillPayoutLine,
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
  | "scheduled_date"
  | "scheduled_start_at"
>;

export async function markSelfBillsPaid(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const paidDay = nowIso.slice(0, 10);
  // Set status + wise_paid_at so Money Out Ready (filters on both) drops the row immediately.
  const full = await supabase
    .from("self_bills")
    .update({ status: "paid", paid_at: paidDay, wise_paid_at: nowIso })
    .in("id", ids);
  if (!full.error) return;

  const msg = String(full.error.message ?? "");
  if (/wise_paid_at|paid_at|column|schema|PGRST204/i.test(msg)) {
    const withoutWise = await supabase
      .from("self_bills")
      .update({ status: "paid", paid_at: paidDay })
      .in("id", ids);
    if (!withoutWise.error) return;
    if (/paid_at|column|schema|PGRST204/i.test(String(withoutWise.error.message ?? ""))) {
      const { error } = await supabase.from("self_bills").update({ status: "paid" }).in("id", ids);
      if (error) throw error;
      return;
    }
    throw withoutWise.error;
  }
  throw full.error;
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
  /** Linhas de visita deste documento. Ver o comentário do cálculo abaixo. */
  visits?: SelfBillPayoutLine[] | null,
): number {
  if (isSelfBillPayoutVoided(sb)) return 0;
  let base = 0;
  if (sb.bill_origin === "internal") {
    base = Math.max(0, Math.round(Number(sb.net_payout ?? 0) * 100) / 100);
  } else {
    const list = jobs ?? [];
    // Documento só de visita tem zero linha de job e não pode cair no
    // `net_payout` cru: o valor dele sai das visitas, logo abaixo.
    if (list.length === 0 && (visits ?? []).length === 0) {
      base = Math.max(0, Math.round(Number(sb.net_payout ?? 0) * 100) / 100);
    } else {
      let due = 0;
      for (const j of list) {
        if (!jobContributesToSelfBillPayout(j)) continue;
        /**
         * Job cancelado vale a COMPENSAÇÃO, não o `partner_cost`.
         *
         * `jobContributesToSelfBillPayout` deixa o cancelado entrar quando há
         * compensação a pagar, e logo em seguida `jobLinePartnerGross` lia
         * `partner_cost + materials`, que num job cancelado é £0. O job passava
         * pelo filtro e valia zero.
         *
         * Medido em 21/08/2026 no G&M Services: o PDF dizia £500 (com os £200
         * de compensação do JOB-9436) e a coluna "Outstanding" dizia £300. O
         * parceiro receberia £200 a menos do que o próprio documento promete,
         * no dia do pagamento.
         */
        const cap =
          j.status === "cancelled"
            ? officeCancellationPartnerPayoutGbp(j as Job)
            : jobLinePartnerGross(j);
        const paid = partnerPaidByJobId[j.id] ?? 0;
        due += Math.max(0, cap - paid);
      }
      /**
       * Dinheiro de VISITA (mig 161/276) entra pelas linhas dela, nunca por
       * dedução a partir de `net_payout`.
       *
       * A primeira versão fazia `net_payout − Σ(linhas de job)` para trazer o
       * que o PDF promete a mais. Isso transformava `net_payout` no PISO do
       * que sai pelo Wise: documento com total velho (job desvinculado, job que
       * parou de contribuir, recompute que não rodou) passava a pagar a
       * diferença em silêncio. O valor tem que vir da linha, como o do job.
       *
       * Quem não passa `visits` fica com as linhas de job apenas: sai MENOR
       * que o PDF, que é o erro seguro — visível na conferência, sem pagar a
       * mais.
       */
      const visitCaps = (visits ?? []).reduce(
        (acc, v) => acc + (Number(v.labour) || 0) + (Number(v.materials) || 0),
        0,
      );
      base = Math.round((due + Math.max(0, visitCaps)) * 100) / 100;
    }
  }
  return selfBillWisePayAmount(sb, installments, base);
}

export async function computeLinkedJobsMapsForSelfBillIds(ids: string[]): Promise<{
  map: Record<string, SelfBillJobLine[]>;
  partnerPaidByJobId: Record<string, number>;
  /** Linhas de visita por self-bill, para o Outstanding bater com o PDF. */
  visitsBySelfBillId: Record<string, SelfBillPayoutLine[]>;
}> {
  if (ids.length === 0) return { map: {}, partnerPaidByJobId: {}, visitsBySelfBillId: {} };
  const rows = await listJobsLinkedToSelfBillIds(ids);
  const map: Record<string, SelfBillJobLine[]> = {};
  for (const j of rows) {
    const sid = j.self_bill_id as string;
    if (!map[sid]) map[sid] = [];
    map[sid].push(j as SelfBillJobLine);
  }
  const jobIds = [...new Set(rows.map((r) => r.id))];
  const [partnerPaidByJobId, visitsBySelfBillId] = await Promise.all([
    fetchPartnerPaidTotalsByJobIds(jobIds),
    // Banco antigo não tem a coluna: o documento vale pelas linhas de job.
    listVisitPayoutLinesBySelfBillId(ids).catch((e) => {
      console.error("listVisitPayoutLinesBySelfBillId:", e);
      return {} as Record<string, SelfBillPayoutLine[]>;
    }),
  ]);
  return { map, partnerPaidByJobId, visitsBySelfBillId };
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
