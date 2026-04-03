import type { Job, JobPaymentType } from "@/types/database";

const EPS = 0.02;

/**
 * Split a customer payment across deposit and final rows (partial payments)
 * following the job schedule. Remainder beyond scheduled final goes to customer_final.
 */
export function allocateCustomerPaymentToSchedule(
  job: Job,
  depositPaid: number,
  finalPaid: number,
  paymentAmount: number,
): { type: JobPaymentType; amount: number }[] {
  const depNeed = Number(job.customer_deposit ?? 0);
  const finNeed = Number(job.customer_final_payment ?? 0);
  const depRem = Math.max(0, depNeed - depositPaid);
  let left = Math.round(paymentAmount * 100) / 100;
  const out: { type: JobPaymentType; amount: number }[] = [];
  if (depRem > EPS && left > EPS) {
    const d = Math.min(left, depRem);
    out.push({ type: "customer_deposit", amount: Math.round(d * 100) / 100 });
    left = Math.round((left - d) * 100) / 100;
  }
  if (left > EPS) {
    if (finNeed > EPS) {
      const f = Math.min(left, Math.max(0, finNeed - finalPaid));
      if (f > EPS) {
        out.push({ type: "customer_final", amount: Math.round(f * 100) / 100 });
        left = Math.round((left - f) * 100) / 100;
      }
    }
    if (left > EPS) {
      out.push({ type: "customer_final", amount: left });
    }
  }
  return out;
}
