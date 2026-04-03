import type { Job, JobPayment, JobPaymentMethod } from "@/types/database";
import { getJob, updateJob } from "@/services/jobs";
import { createJobPayment } from "@/services/job-payments";
import { allocateCustomerPaymentToSchedule } from "@/lib/allocate-customer-payment";
import { applyCustomerExtraPatch, applyPartnerExtraPatch } from "@/lib/job-extra-charges";
import { bumpLinkedInvoiceAmountsToJobSchedule } from "@/lib/sync-invoice-amount-from-job";
import { partnerPaymentCap } from "@/lib/job-financials";
import { syncSelfBillAfterJobChange } from "@/services/self-bills";

export type JobMoneyActionKind = "client" | "partner";

export type ExecuteJobMoneyActionInput = {
  job: Job;
  kind: JobMoneyActionKind;
  /** Increases job totals before recording (invoice + self-bill where relevant). */
  extra: boolean;
  amount: number;
  paymentDate: string;
  method: JobPaymentMethod;
  note?: string;
  bankReference?: string;
  customerPayments: JobPayment[];
  partnerPayments: JobPayment[];
};

/**
 * Single entry for job money moves: auto-splits customer partials (deposit/final),
 * optional extras bump job + invoice + self-bill, partner cap checks with optional extra payout.
 */
export async function executeJobMoneyAction(input: ExecuteJobMoneyActionInput): Promise<Job> {
  const {
    job,
    kind,
    extra,
    amount,
    paymentDate,
    method,
    note,
    bankReference,
    customerPayments,
    partnerPayments,
  } = input;

  const a = Math.round(amount * 100) / 100;
  if (a <= 0) throw new Error("Enter an amount greater than zero");

  const noteTrim = note?.trim();
  const bankTrim = bankReference?.trim();

  if (kind === "client") {
    if (extra) {
      if (method === "stripe") {
        throw new Error("For extras, use Bank or Cash — or collect via Stripe link first, then record with Bank.");
      }
      const patch = applyCustomerExtraPatch(job, a, "extras");
      const updated = await updateJob(job.id, patch);
      await bumpLinkedInvoiceAmountsToJobSchedule(updated);
      await createJobPayment({
        job_id: job.id,
        type: "customer_final",
        amount: a,
        payment_date: paymentDate,
        note: noteTrim ? `Extra · ${noteTrim}` : "Extra charge",
        payment_method: method,
        bank_reference: bankTrim || undefined,
      });
      await syncSelfBillAfterJobChange(updated);
      const fresh = await getJob(job.id);
      if (!fresh) throw new Error("Job not found after update");
      return fresh;
    }

    const depPaid = customerPayments.filter((p) => p.type === "customer_deposit").reduce((s, p) => s + Number(p.amount), 0);
    const finPaid = customerPayments.filter((p) => p.type === "customer_final").reduce((s, p) => s + Number(p.amount), 0);
    const chunks = allocateCustomerPaymentToSchedule(job, depPaid, finPaid, a);
    if (chunks.length === 0) throw new Error("Could not apply payment to this job schedule");

    for (const ch of chunks) {
      await createJobPayment({
        job_id: job.id,
        type: ch.type,
        amount: ch.amount,
        payment_date: paymentDate,
        note: noteTrim || undefined,
        payment_method: method,
        bank_reference: bankTrim || undefined,
      });
    }
    const fresh = await getJob(job.id);
    if (!fresh) throw new Error("Job not found after update");
    return fresh;
  }

  if (!job.partner_id?.trim()) throw new Error("Assign a partner before paying out");

  if (extra) {
    const patch = applyPartnerExtraPatch(job, a, "partner_cost");
    const updated = await updateJob(job.id, patch);
    await syncSelfBillAfterJobChange(updated);
    await createJobPayment({
      job_id: job.id,
      type: "partner",
      amount: a,
      payment_date: paymentDate,
      note: noteTrim ? `Extra payout · ${noteTrim}` : "Extra payout",
      payment_method: method,
      bank_reference: bankTrim || undefined,
    });
    const fresh = await getJob(job.id);
    if (!fresh) throw new Error("Job not found after update");
    return fresh;
  }

  const partnerCap = partnerPaymentCap(job);
  const partnerPaid = partnerPayments.reduce((s, p) => s + Number(p.amount), 0);
  const maxPartner = Math.max(0, partnerCap - partnerPaid);
  if (a > maxPartner + 1e-6) {
    throw new Error(
      `This amount is more than what’s due to the partner (${maxPartner.toFixed(2)}). Turn on Extra payout or lower the amount.`,
    );
  }

  await createJobPayment({
    job_id: job.id,
    type: "partner",
    amount: a,
    payment_date: paymentDate,
    note: noteTrim || undefined,
    payment_method: method,
    bank_reference: bankTrim || undefined,
  });
  const fresh = await getJob(job.id);
  if (!fresh) throw new Error("Job not found after update");
  return fresh;
}
