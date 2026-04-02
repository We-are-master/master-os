import type { Partner, PartnerLegalType } from "@/types/database";

/** Infer legal type when DB column missing (legacy rows). */
export function inferPartnerLegal(p: Pick<Partner, "partner_legal_type" | "crn">): PartnerLegalType {
  return p.partner_legal_type ?? (p.crn?.trim() ? "limited_company" : "self_employed");
}

/**
 * 0–100: phone, address, coverage, correct UTR/CRN, VAT, core identity.
 */
export function computeProfileCompletenessScore(partner: Partner): number {
  let earned = 0;
  let max = 0;
  const step = (ok: boolean, w: number) => {
    max += w;
    if (ok) earned += w;
  };
  step(!!partner.email?.trim(), 14);
  step(!!partner.phone?.trim(), 12);
  step(!!partner.partner_address?.trim() || !!partner.location?.trim(), 14);
  const hasCoverage =
    (partner.uk_coverage_regions?.length ?? 0) > 0 ||
    !!formatCoverageFallback(partner)?.trim();
  step(hasCoverage, 14);
  const legal = inferPartnerLegal(partner);
  step(legal === "limited_company" ? !!partner.crn?.trim() : !!partner.utr?.trim(), 18);
  step(!!partner.vat_number?.trim(), 8);
  step(!!partner.company_name?.trim() && !!partner.contact_name?.trim(), 20);
  return max > 0 ? Math.round((earned / max) * 100) : 0;
}

function formatCoverageFallback(p: Partner): string {
  if (p.uk_coverage_regions?.length) return "";
  return p.location ?? "";
}

/**
 * Document checklist score 0–100 (valid non-expired match per required item).
 * Same semantics as previous `computeComplianceScore` in partners page.
 */
export function computeDocumentChecklistScore(
  hasValidByRequirement: boolean[],
): number {
  if (hasValidByRequirement.length === 0) return 100;
  const validCount = hasValidByRequirement.filter(Boolean).length;
  return Math.round((validCount / hasValidByRequirement.length) * 100);
}

export function countExpiredDocuments(
  docs: { expires_at?: string | null }[],
): number {
  const now = new Date();
  return docs.filter((d) => d.expires_at && new Date(d.expires_at) < now).length;
}

/**
 * Combined 0–100: documents + profile + extra penalty for expired docs.
 */
export function mergePartnerComplianceScore(
  documentScore: number,
  profileScore: number,
  expiredCount: number,
): number {
  const expiredPenalty = Math.min(38, expiredCount * 14);
  const blended = 0.52 * documentScore + 0.33 * profileScore + 0.15 * Math.max(0, 100 - expiredPenalty);
  return Math.max(0, Math.min(100, Math.round(blended)));
}
