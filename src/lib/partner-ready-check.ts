import type { Partner } from "@/types/database";
import {
  type PartnerDocLike,
  type PartnerDocRuleRow,
  buildFullMandatoryDocsForComplianceScore,
  getRequiredDocComplianceStatus,
} from "@/lib/partner-required-docs";

/**
 * True when a partner belongs in the "Ready" review queue: still in the
 * onboarding stage but has already uploaded every mandatory document.
 *
 * "Uploaded" here means the partner has at least one row for that requirement
 * regardless of admin review state (pending / rejected / expired all count),
 * matching the product intent that a partner should surface for admin review
 * as soon as they finish uploading — not only after each doc is approved.
 */
export function partnerIsReadyForReview(
  partner: Pick<Partner, "status" | "trades" | "trade" | "partner_legal_type" | "utr" | "crn" | "vat_number" | "vat_registered"> & {
    /** Keep the signature loose so callers can pass any Partner subset. */
    [key: string]: unknown;
  } | null,
  docsByPartnerId: PartnerDocLike[] | null | undefined,
  rules?: PartnerDocRuleRow[] | null,
): boolean {
  if (!partner) return false;
  if (partner.status !== "onboarding") return false;

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
  if (mandatory.length === 0) return false;

  const docs = docsByPartnerId ?? [];
  for (const req of mandatory) {
    if (getRequiredDocComplianceStatus(docs, req) === "missing") return false;
  }
  return true;
}
