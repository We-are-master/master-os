import type { Job, JobPayment, JobPaymentMethod, JobPaymentType } from "@/types/database";
import { getSupabase } from "./base";
import { getJob, updateJob } from "./jobs";
import { createJobPayment } from "./job-payments";
import { allocateCustomerPaymentToSchedule } from "@/lib/allocate-customer-payment";
import { applyCustomerExtraPatch, applyPartnerExtraPatch } from "@/lib/job-extra-charges";
import { reconcileJobCustomerPaymentFlags } from "@/lib/reconcile-job-customer-flags";
import { bumpLinkedInvoiceAmountsToJobSchedule } from "@/lib/sync-invoice-amount-from-job";
import { partnerPaymentCap } from "@/lib/job-financials";
import { syncSelfBillAfterJobChange } from "@/services/self-bills";

/** Payments (ledger) vs price adjustments (job row + invoice / self-bill only). */
export type JobMoneyMode = "client_pay" | "client_extra" | "partner_pay" | "partner_extra";

/** For `client_pay`: record as deposit vs final-balance partial (overrides automatic split). */
export type ClientPayApplyAs = "deposit" | "final";

export type ExecuteJobMoneyActionInput = {
  job: Job;
  mode: JobMoneyMode;
  amount: number;
  paymentDate: string;
  /** Used for payment rows only; extras may ignore. */
  method: JobPaymentMethod;
  note?: string;
  bankReference?: string;
  customerPayments: JobPayment[];
  partnerPayments: JobPayment[];
  /** When set for `client_pay`, allocates the whole amount to that bucket. */
  clientPayApplyAs?: ClientPayApplyAs;
};

/**
 * Client/partner money: payments only hit `job_payments`; extras only bump job + invoice / self-bill (no mixed rows).
 */
const PAY_EPS = 0.02;

export async function executeJobMoneyAction(input: ExecuteJobMoneyActionInput): Promise<Job> {
  const { job, mode, amount, paymentDate, method, note, bankReference, customerPayments, partnerPayments, clientPayApplyAs } =
    input;

  const a = Math.round(amount * 100) / 100;
  if (a <= 0) throw new Error("Enter an amount greater than zero");

  const noteTrim = note?.trim();
  const bankTrim = bankReference?.trim();

  if (mode === "client_extra") {
    if (method === "stripe") {
      throw new Error("Extra charges cannot use Stripe here — use Bank or Cash, or add the charge then collect via link.");
    }
    const patch = applyCustomerExtraPatch(job, a, "extras");
    const updated = await updateJob(job.id, patch);
    await bumpLinkedInvoiceAmountsToJobSchedule(updated);
    await syncSelfBillAfterJobChange(updated);
    await reconcileJobCustomerPaymentFlags(getSupabase(), job.id);
    const fresh = await getJob(job.id);
    if (!fresh) throw new Error("Job not found after update");
    return fresh;
  }

  if (mode === "client_pay") {
    const depPaid = customerPayments.filter((p) => p.type === "customer_deposit").reduce((s, p) => s + Number(p.amount), 0);
    const finPaid = customerPayments.filter((p) => p.type === "customer_final").reduce((s, p) => s + Number(p.amount), 0);
    const depNeed = Number(job.customer_deposit ?? 0);
    const depRem = Math.max(0, depNeed - depPaid);

    let chunks: { type: JobPaymentType; amount: number }[];
    if (clientPayApplyAs === "deposit") {
      if (depNeed <= PAY_EPS) {
        throw new Error("This job has no scheduled deposit—use Partial payment (final balance).");
      }
      if (depRem <= PAY_EPS) {
        throw new Error("The deposit is already fully paid—use Partial payment (final balance).");
      }
      if (a > depRem + PAY_EPS) {
        throw new Error(
          `Only £${depRem.toFixed(2)} remains toward the deposit—lower the amount or record the rest as a partial payment on the final balance.`,
        );
      }
      chunks = [{ type: "customer_deposit", amount: a }];
    } else if (clientPayApplyAs === "final") {
      chunks = [{ type: "customer_final", amount: a }];
    } else {
      chunks = allocateCustomerPaymentToSchedule(job, depPaid, finPaid, a);
    }

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

  if (mode === "partner_extra") {
    if (!job.partner_id?.trim()) throw new Error("Assign a partner first");
    const patch = applyPartnerExtraPatch(job, a, "partner_cost");
    const updated = await updateJob(job.id, patch);
    await syncSelfBillAfterJobChange(updated);
    const fresh = await getJob(job.id);
    if (!fresh) throw new Error("Job not found after update");
    return fresh;
  }

  if (mode === "partner_pay") {
    if (!job.partner_id?.trim()) throw new Error("Assign a partner before paying out");

    const partnerCap = partnerPaymentCap(job);
    const partnerPaid = partnerPayments.reduce((s, p) => s + Number(p.amount), 0);
    const maxPartner = Math.max(0, partnerCap - partnerPaid);
    if (a > maxPartner + 1e-6) {
      throw new Error(
        `This amount is more than what’s due to the partner (${maxPartner.toFixed(2)}). Use Add extra payout to increase their cost, or lower the amount.`,
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

  const _exhaustive: never = mode;
  throw new Error(`Unknown mode: ${String(_exhaustive)}`);
}
