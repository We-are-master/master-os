import type { Partner } from "@/types/database";
import {
  type PartnerDocLike,
  type PartnerDocRuleRow,
  buildFullMandatoryDocsForComplianceScore,
  getRequiredDocComplianceStatus,
} from "@/lib/partner-required-docs";

type ReadyPartnerLike =
  | (Pick<Partner, "status" | "trades" | "trade" | "partner_legal_type" | "utr" | "crn" | "vat_number" | "vat_registered"> & {
      /** Keep the signature loose so callers can pass any Partner subset. */
      [key: string]: unknown;
    })
  | null;

export interface PartnerOnboardingProgress {
  /** Mandatory docs the partner has uploaded (any review state except missing). */
  submitted: number;
  /** Total mandatory docs required for this partner (core + legal + agreements + trade certs). */
  total: number;
  /** submitted / total as an integer 0–100. */
  pct: number;
  /** True once every mandatory doc is uploaded — i.e. the partner belongs in the Ready queue. */
  ready: boolean;
}

/**
 * How far a partner is through the *upload* side of onboarding.
 *
 * "Uploaded" means the partner has at least one row for that requirement
 * regardless of admin review state (pending / rejected / expired all count) —
 * a partner should surface for admin review as soon as they finish uploading,
 * not only after each doc is approved. This is the number the Onboarding/Ready
 * tab bar shows, and it hits 100% exactly when the partner enters the Ready queue.
 */
export function computePartnerOnboardingProgress(
  partner: ReadyPartnerLike,
  docsByPartnerId: PartnerDocLike[] | null | undefined,
  rules?: PartnerDocRuleRow[] | null,
): PartnerOnboardingProgress {
  const empty: PartnerOnboardingProgress = { submitted: 0, total: 0, pct: 0, ready: false };
  if (!partner) return empty;
  // The Onboarding tab covers both onboarding and needs_attention partners, so the
  // progress bar must fill for either; the Ready queue is gated to `onboarding` by the caller.
  if (partner.status !== "onboarding" && partner.status !== "needs_attention") return empty;

  const trades = Array.isArray(partner.trades) && partner.trades.length > 0
    ? partner.trades
    : partner.trade
      ? [String(partner.trade)]
      : [];
  const mandatory = buildFullMandatoryDocsForComplianceScore(
    partner as unknown as Partner,
    trades,
    rules,
  );
  if (mandatory.length === 0) return empty;

  const docs = docsByPartnerId ?? [];
  let submitted = 0;
  for (const req of mandatory) {
    if (getRequiredDocComplianceStatus(docs, req) !== "missing") submitted += 1;
  }
  const total = mandatory.length;
  const pct = Math.round((submitted / total) * 100);
  return { submitted, total, pct, ready: submitted === total };
}

/**
 * True when a partner belongs in the "Ready" review queue: still in the
 * onboarding stage but has already uploaded every mandatory document.
 */
export function partnerIsReadyForReview(
  partner: ReadyPartnerLike,
  docsByPartnerId: PartnerDocLike[] | null | undefined,
  rules?: PartnerDocRuleRow[] | null,
): boolean {
  return computePartnerOnboardingProgress(partner, docsByPartnerId, rules).ready;
}
