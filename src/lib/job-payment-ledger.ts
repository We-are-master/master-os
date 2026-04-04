import { isCustomerExtraChargePaymentNote, isPartnerExtraPayoutPaymentNote } from "@/lib/job-extra-charges";

/**
 * Legacy rows: extra charge was stored as customer_* payment — must not reduce amount due or invoice paid allocation.
 */
export function isLegacyMisclassifiedCustomerPayment(p: { type: string; note?: string | null }): boolean {
  return (
    (p.type === "customer_deposit" || p.type === "customer_final") && isCustomerExtraChargePaymentNote(p.note)
  );
}

/**
 * Legacy rows: extra partner cost was stored as partner payment — must not reduce partner amount due.
 */
export function isLegacyMisclassifiedPartnerPayment(p: { type: string; note?: string | null }): boolean {
  return p.type === "partner" && isPartnerExtraPayoutPaymentNote(p.note);
}

/** Cash sent to the partner only — excludes legacy rows that mis-recorded extra payout as a payment. */
export function sumPartnerRecordedPayoutsForCap(
  payments: { type: string; amount: number; note?: string | null }[],
): number {
  return payments
    .filter((p) => p.type === "partner" && !isLegacyMisclassifiedPartnerPayment(p))
    .reduce((s, p) => s + Number(p.amount ?? 0), 0);
}
