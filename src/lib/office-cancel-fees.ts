/**
 * Office cancel: void labour docs, create + finalize cancellation fee invoice / self-bill.
 * Zendesk macro cancel does not call this — fees are OS modal only (v1).
 */

import type { Job } from "@/types/database";
import { getSupabase } from "@/services/base";
import { getCompanySettings } from "@/services/company";
import { getClient } from "@/services/clients";
import { getAccount } from "@/services/accounts";
import { cancelOpenInvoicesForJobCancellation, updateInvoice } from "@/services/invoices";
import { getInvoiceDueDateIsoForClient } from "@/services/invoice-due-date";
import { updateJob } from "@/services/jobs";
import {
  cancelOpenSelfBillsForJobCancellation,
  ensureWeeklySelfBillForJob,
  refreshSelfBillPayoutState,
  updateSelfBill,
} from "@/services/self-bills";
import { createOrAppendJobInvoice } from "@/services/weekly-account-invoice";
import {
  buildCancellationFeeJobPatch,
  officeCancellationPartnerClawbackGbp,
  officeCancellationPartnerPayoutGbp,
  type OfficeCancelFeeChoices,
} from "@/lib/job-cancel-economics";

export type { OfficeCancelFeeChoices };
export { buildCancellationFeeJobPatch };

const EPS = 0.02;

function roundGbp(n: number): number {
  return Math.round(Math.max(0, n) * 100) / 100;
}

export type OfficeCancelFeeDefaults = {
  clientFeeGbp: number | null;
  partnerOwesFeeGbp: number | null;
};

export async function resolveOfficeCancelFeeDefaults(
  job: Pick<Job, "client_id" | "partner_id">,
): Promise<OfficeCancelFeeDefaults> {
  let clientFee: number | null = null;
  let partnerOwes: number | null = null;
  const company = await getCompanySettings().catch(() => null);

  if (job.client_id?.trim()) {
    const client = await getClient(job.client_id);
    if (client?.source_account_id) {
      const account = await getAccount(client.source_account_id);
      const v = Number(account?.default_client_cancel_fee_gbp ?? 0);
      if (v > EPS) clientFee = roundGbp(v);
    }
    if (clientFee == null) {
      const v = Number(company?.default_client_cancel_fee_gbp ?? 0);
      if (v > EPS) clientFee = roundGbp(v);
    }
  }

  if (job.partner_id?.trim()) {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("partners")
      .select("default_partner_cancel_fee_gbp")
      .eq("id", job.partner_id)
      .maybeSingle();
    const partnerDefault = Number(
      (data as { default_partner_cancel_fee_gbp?: number | null } | null)?.default_partner_cancel_fee_gbp ?? 0,
    );
    if (partnerDefault > EPS) partnerOwes = roundGbp(partnerDefault);
    else {
      const fallback = Number(company?.partner_cancellation_fee_gbp ?? 0);
      if (fallback > EPS) partnerOwes = roundGbp(fallback);
    }
  }

  return { clientFeeGbp: clientFee, partnerOwesFeeGbp: partnerOwes };
}

export async function applyOfficeCancellationFees(args: {
  job: Job;
  cancellationReason: string;
  priorInvoiceId?: string | null;
  priorSelfBillId?: string | null;
}): Promise<Job> {
  const { job, cancellationReason } = args;
  const clientFee = Number(job.cancellation_fee_client_gbp ?? 0);
  const partnerOwes = officeCancellationPartnerClawbackGbp(job);
  const partnerPaid = officeCancellationPartnerPayoutGbp(job);
  const hasPartnerFee = partnerOwes > EPS || partnerPaid > EPS;
  const hasClientFee = clientFee > EPS;

  await cancelOpenInvoicesForJobCancellation({
    jobReference: job.reference,
    cancellationReason,
    primaryInvoiceId: args.priorInvoiceId ?? job.invoice_id,
  });

  if (!hasPartnerFee) {
    await cancelOpenSelfBillsForJobCancellation({
      jobReference: job.reference,
      primarySelfBillId: args.priorSelfBillId ?? job.self_bill_id,
    });
  }

  const financeAnchorDate = job.scheduled_date
    ? new Date(`${String(job.scheduled_date).slice(0, 10)}T12:00:00`)
    : new Date();
  const linkPatch: Partial<Job> = {};

  if (hasClientFee) {
    const dueDate = await getInvoiceDueDateIsoForClient(job.client_id ?? null, financeAnchorDate);
    const inv = await createOrAppendJobInvoice(
      job,
      {
        client_name: job.client_name ?? "Client",
        amount: roundGbp(clientFee),
        status: "draft",
        invoice_kind: "other",
        collection_stage: "awaiting_final",
      },
      { financeAnchorDate },
    );
    const finalStatus = clientFee <= EPS ? "paid" : "pending";
    await updateInvoice(inv.id, {
      amount: roundGbp(clientFee),
      status: finalStatus,
      collection_stage: finalStatus === "paid" ? "completed" : "awaiting_final",
      due_date: dueDate,
      ...(finalStatus === "paid" ? { paid_date: new Date().toISOString().slice(0, 10) } : {}),
    });
    linkPatch.cancellation_fee_invoice_id = inv.id;
  }

  if (hasPartnerFee && job.partner_id?.trim()) {
    const selfBillId = await ensureWeeklySelfBillForJob(job, { weekAnchorDate: financeAnchorDate });
    if (selfBillId) {
      linkPatch.self_bill_id = selfBillId;
      await refreshSelfBillPayoutState(selfBillId);
      if (partnerPaid > EPS) {
        await updateSelfBill(selfBillId, { status: "awaiting_payment" });
      }
    }
  }

  if (Object.keys(linkPatch).length === 0) return job;
  return updateJob(job.id, linkPatch, { skipSelfBillSync: true, skipCancelDocVoid: true });
}
