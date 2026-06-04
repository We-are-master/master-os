import { isValid, parseISO } from "date-fns";
import { dueDateIsoFromPaymentTerms } from "@/lib/invoice-payment-terms";
import { partnerFieldSelfBillPaymentDueDate } from "@/lib/self-bill-period";

/** Org default for partner self-bill payout when the partner has no schedule set. */
export const ORG_PARTNER_PAYOUT_STANDARD_TERMS = "Every 2 weeks on Friday";

export type DueDateSource = "standard" | "partner" | "custom";

function normalizeYmd(value: string | null | undefined): string {
  const s = value?.trim().slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function partnerPayoutAnchorFromWeekEnd(weekEndYmd: string): Date {
  const d = parseISO(weekEndYmd);
  return isValid(d) ? d : new Date();
}

/** Due date from org standard terms (biweekly Friday), anchored on self-bill week end. */
export function computeOrgStandardPartnerDueIso(weekEndYmd: string): string {
  return dueDateIsoFromPaymentTerms(
    partnerPayoutAnchorFromWeekEnd(weekEndYmd),
    ORG_PARTNER_PAYOUT_STANDARD_TERMS,
  );
}

/** Partner self-bill due: partner terms when set, otherwise org standard (not legacy Friday+5). */
export function computePartnerSelfBillDueIso(
  weekEndYmd: string,
  partnerTerms: string | null | undefined,
): string {
  const terms = partnerTerms?.trim();
  if (terms) return partnerFieldSelfBillPaymentDueDate(weekEndYmd, terms);
  return computeOrgStandardPartnerDueIso(weekEndYmd);
}

export function inferPartnerDueDateSource(
  storedDue: string | null | undefined,
  weekEndYmd: string,
  partnerTerms: string | null | undefined,
): DueDateSource {
  const stored = normalizeYmd(storedDue);
  const standard = computeOrgStandardPartnerDueIso(weekEndYmd);
  const partner = computePartnerSelfBillDueIso(weekEndYmd, partnerTerms);
  if (!stored) return partnerTerms?.trim() ? "partner" : "standard";
  if (partnerTerms?.trim() && stored === partner) return "partner";
  if (stored === standard) return "standard";
  if (stored === partner) return partnerTerms?.trim() ? "partner" : "standard";
  return "custom";
}

/** Invoice due inferred vs account-terms computation (standard = matches account terms). */
export function inferInvoiceDueDateSource(
  storedDue: string | null | undefined,
  computedFromAccountTerms: string,
): DueDateSource {
  const stored = normalizeYmd(storedDue);
  const computed = normalizeYmd(computedFromAccountTerms);
  if (!stored || !computed) return "standard";
  if (stored === computed) return "standard";
  return "custom";
}

export function dueDateSourceLabel(source: DueDateSource): string {
  switch (source) {
    case "standard":
      return "Standard";
    case "partner":
      return "Partner";
    case "custom":
      return "Custom";
  }
}
