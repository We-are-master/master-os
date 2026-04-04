import type { Job, JobPayment, JobPaymentMethod } from "@/types/database";
import { getSupabase } from "./base";
import { getJob, updateJob } from "./jobs";
import { createJobPayment } from "./job-payments";
import { applyCustomerExtraPatch, applyPartnerExtraPatch } from "@/lib/job-extra-charges";
import { sumPartnerRecordedPayoutsForCap } from "@/lib/job-payment-ledger";
import { reconcileJobCustomerPaymentFlags } from "@/lib/reconcile-job-customer-flags";
import { bumpLinkedInvoiceAmountsToJobSchedule } from "@/lib/sync-invoice-amount-from-job";
import { partnerPaymentCap } from "@/lib/job-financials";
import { syncSelfBillAfterJobChange } from "@/services/self-bills";

function composeLedgerNote(ledgerLabel?: string, userNote?: string): string | undefined {
  const label = ledgerLabel?.trim();
  const note = userNote?.trim();
  if (label && note) return `[${label}] ${note}`;
  if (label) return `[${label}]`;
  if (note) return note;
  return undefined;
}

/** Payments (ledger) vs price adjustments (job row + invoice / self-bill only). */
export type JobMoneyMode = "client_pay" | "client_extra" | "partner_pay" | "partner_extra";

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
  /** When mode is client_pay: post as deposit vs final (otherwise auto-split from schedule). */
  clientPayApplyAs?: ClientPayApplyAs;
  /** Optional history label only (prefixed in note); does not affect allocation. */
  paymentLedgerLabel?: string;
};

/**
 * Client/partner money: payments only hit `job_payments`; extras only bump job + invoice / self-bill (no mixed rows).
 */
export async function executeJobMoneyAction(input: ExecuteJobMoneyActionInput): Promise<Job> {
  const {
    job,
    mode,
    amount,
    paymentDate,
    method,
    note,
    bankReference,
    customerPayments,
    partnerPayments,
    clientPayApplyAs,
    paymentLedgerLabel,
  } = input;

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
    const depNeed = Number(job.customer_deposit ?? 0);
    const depRem = Math.max(0, depNeed - depPaid);

    const applyAs = clientPayApplyAs ?? (depRem > 0.02 ? "deposit" : "final");
    const paymentNote = composeLedgerNote(paymentLedgerLabel, noteTrim);

    if (applyAs === "deposit") {
      if (depRem <= 0.02) {
        throw new Error("No deposit is due — choose partial payment (final balance).");
      }
      if (a > depRem + 1e-6) {
        throw new Error(`Outstanding deposit is only £${depRem.toFixed(2)}. Lower the amount or use partial payment (final balance).`);
      }
      await createJobPayment({
        job_id: job.id,
        type: "customer_deposit",
        amount: a,
        payment_date: paymentDate,
        note: paymentNote,
        payment_method: method,
        bank_reference: bankTrim || undefined,
      });
    } else {
      await createJobPayment({
        job_id: job.id,
        type: "customer_final",
        amount: a,
        payment_date: paymentDate,
        note: paymentNote,
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
    const partnerPaid = sumPartnerRecordedPayoutsForCap(partnerPayments);
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
      note: composeLedgerNote(paymentLedgerLabel, noteTrim),
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
