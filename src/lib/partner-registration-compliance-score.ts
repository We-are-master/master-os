import {
  PARTNER_REGISTRATION_FIELD_CATALOG,
  resolvePartnerRegistrationRule,
  type PartnerRegistrationRuleRow,
} from "@/lib/partner-registration-fields";
import type { PartnerDocRuleRow } from "@/lib/partner-required-docs";

/** Profile slice weights — must stay aligned with `getProfileCompletenessItems` in partner-compliance.ts. */
export const PROFILE_REGISTRATION_WEIGHTS: Record<string, number> = {
  account: 34, // email 14 + identity 20
  phone: 12,
  address: 14,
  coverage: 14,
  tax_id: 18,
  vat: 8,
};

/** Blended compliance mix from `mergePartnerComplianceScore`. */
const PROFILE_BLEND = 0.33;
const DOCUMENT_BLEND = 0.52;

export function formatComplianceScoreLabel(pct: number): string {
  if (pct <= 0) return "—";
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

/**
 * Effective % of the blended compliance score each row contributes when visible + mandatory.
 * Optional or hidden rows show "Opt." / "—". Funnel-only fields (no profile/doc weight) show "—".
 */
export function computeRegistrationComplianceScoreLabels(params: {
  fieldRules: PartnerRegistrationRuleRow[];
  docRules: PartnerDocRuleRow[];
}): { fields: Record<string, string>; documents: Record<string, string> } {
  const { fieldRules, docRules } = params;

  let profileWeightTotal = 0;
  for (const [id, weight] of Object.entries(PROFILE_REGISTRATION_WEIGHTS)) {
    const { visible, mandatory } = resolvePartnerRegistrationRule(id, fieldRules);
    if (visible && mandatory && weight > 0) profileWeightTotal += weight;
  }

  const fields: Record<string, string> = {};
  for (const entry of PARTNER_REGISTRATION_FIELD_CATALOG) {
    const { visible, mandatory } = resolvePartnerRegistrationRule(entry.id, fieldRules);
    if (!visible) {
      fields[entry.id] = "—";
      continue;
    }
    if (!mandatory) {
      fields[entry.id] = "Opt.";
      continue;
    }
    const weight = PROFILE_REGISTRATION_WEIGHTS[entry.id];
    if (weight && profileWeightTotal > 0) {
      fields[entry.id] = formatComplianceScoreLabel((weight / profileWeightTotal) * PROFILE_BLEND * 100);
    } else {
      fields[entry.id] = "—";
    }
  }

  const mandatoryDocIds = docRules.filter((r) => r.enabled && r.mandatory).map((r) => r.id);
  const perDocPct =
    mandatoryDocIds.length > 0 ? (1 / mandatoryDocIds.length) * DOCUMENT_BLEND * 100 : 0;

  const documents: Record<string, string> = {};
  for (const rule of docRules) {
    if (!rule.enabled) {
      documents[rule.id] = "—";
    } else if (!rule.mandatory) {
      documents[rule.id] = "Opt.";
    } else {
      documents[rule.id] = formatComplianceScoreLabel(perDocPct);
    }
  }

  return { fields, documents };
}

/** Sum of mandatory profile + document score labels (excludes funnel-only rows). */
export function computeMandatoryComplianceScoreTotal(params: {
  fieldRules: PartnerRegistrationRuleRow[];
  docRules: PartnerDocRuleRow[];
}): number {
  const { fields, documents } = computeRegistrationComplianceScoreLabels(params);
  const parse = (label: string) => {
    if (label === "—" || label === "Opt." || label === "<1%") return label === "<1%" ? 0.5 : 0;
    const n = Number.parseInt(label.replace("%", ""), 10);
    return Number.isFinite(n) ? n : 0;
  };
  let total = 0;
  for (const v of Object.values(fields)) total += parse(v);
  for (const v of Object.values(documents)) total += parse(v);
  return Math.min(85, Math.round(total));
}
