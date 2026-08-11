import type { Partner } from "@/types/database";
import {
  type PartnerDocLike,
  type PartnerDocRuleRow,
  buildCoreComplianceDocs,
  getRequiredDocComplianceStatus,
} from "@/lib/partner-required-docs";

type ReadyPartnerLike =
  | (Pick<Partner, "status" | "trades" | "trade" | "partner_legal_type" | "utr" | "crn" | "vat_number" | "vat_registered"> & {
      /** Keep the signature loose so callers can pass any Partner subset. */
      [key: string]: unknown;
    })
  | null;

export interface PartnerOnboardingProgress {
  /** Core docs uploaded (Insurance, ID, Right to work) — any review state except missing. */
  submitted: number;
  /** Always 3 (core compliance set). */
  total: number;
  /** submitted / total as an integer 0–100. */
  pct: number;
  /** True once Insurance + ID + Right to work are uploaded — ready to Activate. */
  ready: boolean;
}

/**
 * How far a partner is through core onboarding uploads.
 * Only Insurance, Photo ID, and Right to Work count — everything else is extra.
 */
export function computePartnerOnboardingProgress(
  partner: ReadyPartnerLike,
  docsByPartnerId: PartnerDocLike[] | null | undefined,
  _rules?: PartnerDocRuleRow[] | null,
): PartnerOnboardingProgress {
  const empty: PartnerOnboardingProgress = { submitted: 0, total: 0, pct: 0, ready: false };
  if (!partner) return empty;
  if (partner.status !== "onboarding" && partner.status !== "needs_attention") return empty;

  const mandatory = buildCoreComplianceDocs();
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
 * True when Insurance + ID + Right to work are uploaded (Activate is one click away).
 * Kept for callers; the Ready directory tab has been removed.
 */
export function partnerIsReadyForReview(
  partner: ReadyPartnerLike,
  docsByPartnerId: PartnerDocLike[] | null | undefined,
  rules?: PartnerDocRuleRow[] | null,
): boolean {
  return computePartnerOnboardingProgress(partner, docsByPartnerId, rules).ready;
}
