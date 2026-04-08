import type { Partner, PartnerLegalType } from "@/types/database";

/** Infer legal type when DB column missing (legacy rows). */
export function inferPartnerLegal(p: Pick<Partner, "partner_legal_type" | "crn">): PartnerLegalType {
  return p.partner_legal_type ?? (p.crn?.trim() ? "limited_company" : "self_employed");
}

export type ProfileCompletenessItem = {
  id: string;
  label: string;
  weight: number;
  done: boolean;
  hint: string;
  /** When false, row is informational only (e.g. optional VAT for self-employed) — excluded from profile score and attention count. */
  scoresTowardCompliance?: boolean;
};

/** Limited: complete when not VAT registered, or registered with number; legacy: number on file. Self-employed VAT is optional and does not affect compliance score. */
export function isVatProfileComplete(partner: Partner): boolean {
  const legal = inferPartnerLegal(partner);
  if (legal === "limited_company") {
    const vr = partner.vat_registered;
    if (vr === false) return true;
    if (vr === true) return !!partner.vat_number?.trim();
    return !!partner.vat_number?.trim();
  }
  return !!partner.vat_number?.trim();
}

/** Checklist rows for UI — weights match `computeProfileCompletenessScore`. */
export function getProfileCompletenessItems(partner: Partner): ProfileCompletenessItem[] {
  const legal = inferPartnerLegal(partner);
  const hasCoverage =
    (partner.uk_coverage_regions?.length ?? 0) > 0 ||
    !!formatCoverageFallback(partner)?.trim();
  return [
    { id: "email", label: "Email on file", weight: 14, done: !!partner.email?.trim(), hint: "Add or confirm in Overview." },
    { id: "phone", label: "Phone number", weight: 12, done: !!partner.phone?.trim(), hint: "Add in Overview." },
    {
      id: "address",
      label: "Home / business address (or legacy location)",
      weight: 14,
      done: !!(partner.partner_address?.trim() || partner.location?.trim()),
      hint: "Street and postcode in Overview.",
    },
    {
      id: "coverage",
      label: "Area coverage (UK)",
      weight: 14,
      done: hasCoverage,
      hint: "Select UK regions in Overview (default London).",
    },
    {
      id: "tax_id",
      label: legal === "limited_company" ? "Companies House CRN" : "UTR (HMRC)",
      weight: 18,
      done: legal === "limited_company" ? !!partner.crn?.trim() : !!partner.utr?.trim(),
      hint: legal === "limited_company" ? "Add CRN in Overview." : "Add UTR in Overview.",
    },
    ...(legal === "limited_company"
      ? [
          {
            id: "vat",
            label: "VAT (registered + number, or not registered)",
            weight: 8,
            done: isVatProfileComplete(partner),
            hint: "Say if VAT registered; if yes, add the VAT number.",
          },
        ]
      : [
          {
            id: "vat",
            label: "VAT number (optional)",
            weight: 0,
            done: !!partner.vat_number?.trim(),
            hint: "Add if VAT registered — not included in compliance score.",
            scoresTowardCompliance: false,
          },
        ]),
    {
      id: "identity",
      label: "Company and contact name",
      weight: 20,
      done: !!(partner.company_name?.trim() && partner.contact_name?.trim()),
      hint: "Edit in Overview.",
    },
  ];
}

/**
 * 0–100: phone, address, coverage, correct UTR/CRN, VAT, core identity.
 */
export function computeProfileCompletenessScore(partner: Partner): number {
  const items = getProfileCompletenessItems(partner);
  let earned = 0;
  let max = 0;
  for (const it of items) {
    if (it.scoresTowardCompliance === false) continue;
    max += it.weight;
    if (it.done) earned += it.weight;
  }
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
  docs: { expires_at?: string | null; counts_toward_compliance?: boolean | null }[],
): number {
  const now = new Date();
  return docs.filter(
    (d) =>
      d.counts_toward_compliance !== false && d.expires_at && new Date(d.expires_at) < now,
  ).length;
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
