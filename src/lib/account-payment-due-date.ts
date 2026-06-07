import {
  parseFrontendSetup,
  resolvePartnerPayoutReferenceYmd,
  resolvePartnerPayoutStandardTerms,
  type FrontendSetup,
} from "@/lib/frontend-setup";
import { dueDateIsoFromPaymentTerms } from "@/lib/invoice-payment-terms";
import {
  isBiweeklyFridayPayoutTerms,
  normalizePartnerPayoutStandardTerms,
  ORG_PARTNER_PAYOUT_STANDARD_TERMS,
  workPeriodForJobStartYmd,
} from "@/lib/partner-payout-schedule";

export type AccountPaymentOrgContext = {
  orgStandardTerms: string;
  orgReferenceYmd: string | null;
};

export function orgCtxFromSetup(setup?: FrontendSetup | null): AccountPaymentOrgContext {
  return {
    orgStandardTerms: resolvePartnerPayoutStandardTerms(setup),
    orgReferenceYmd: resolvePartnerPayoutReferenceYmd(setup),
  };
}

function anchorYmdFromDate(base: Date): string {
  const y = base.getFullYear();
  const mo = String(base.getMonth() + 1).padStart(2, "0");
  const day = String(base.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/**
 * True when account terms follow the org biweekly Friday grid (simple label, no embedded `ref`).
 * Cycle strings (`Every 2 weeks cutoff … ref …`) carry their own anchor.
 */
export function isAccountOrgBiweeklyGridTerms(
  paymentTerms: string | null | undefined,
  orgStandardTerms?: string | null,
): boolean {
  const raw = paymentTerms?.trim() ?? "";
  if (!raw) return false;
  if (/every\s+2\s+weeks?\s+cutoff/i.test(raw)) return false;
  if (/every\s+2\s*weeks\s+on\s+friday/i.test(raw)) return true;
  const orgNorm = normalizePartnerPayoutStandardTerms(orgStandardTerms ?? ORG_PARTNER_PAYOUT_STANDARD_TERMS);
  const accountNorm = normalizePartnerPayoutStandardTerms(raw);
  return isBiweeklyFridayPayoutTerms(accountNorm) && accountNorm === orgNorm;
}

/**
 * Invoice due date from account payment terms, aligned with org self-bill biweekly grid when applicable.
 */
export function dueDateIsoFromAccountPaymentTerms(
  base: Date,
  paymentTerms: string | null | undefined,
  orgCtx?: AccountPaymentOrgContext | null,
): string {
  const raw = paymentTerms?.trim() ?? "";

  if (/every\s+2\s+weeks?\s+cutoff/i.test(raw) || /monthly\s+cutoff/i.test(raw)) {
    return dueDateIsoFromPaymentTerms(base, paymentTerms);
  }

  const ctx: AccountPaymentOrgContext = orgCtx ?? {
    orgStandardTerms: ORG_PARTNER_PAYOUT_STANDARD_TERMS,
    orgReferenceYmd: null,
  };

  if (isAccountOrgBiweeklyGridTerms(paymentTerms, ctx.orgStandardTerms)) {
    const period = workPeriodForJobStartYmd(anchorYmdFromDate(base), ctx.orgStandardTerms, ctx.orgReferenceYmd);
    if (period?.payoutDueYmd) return period.payoutDueYmd;
  }

  return dueDateIsoFromPaymentTerms(base, paymentTerms);
}
