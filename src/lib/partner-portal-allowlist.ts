import type { Partner } from "@/types/database";
import {
  buildEnabledPortalExtraDocs,
  buildRequiredDocumentChecklist,
  type PartnerDocRuleRow,
  type RequiredDocDef,
} from "@/lib/partner-required-docs";

/** Extra portal-only requirement ids (not from compliance checklist). */
export const PORTAL_EXTRA_REQUIREMENT_IDS = ["dbs", "other"] as const;
export type PortalExtraRequirementId = (typeof PORTAL_EXTRA_REQUIREMENT_IDS)[number];

/**
 * All requirement ids that may appear on the partner portal for this partner
 * (compliance checklist + optional extras enabled in Setup).
 */
export function getPartnerPortalAllowlistIds(
  partner: Partner,
  rules?: PartnerDocRuleRow[] | null,
): string[] {
  const trades = partner.trades?.length ? partner.trades : [partner.trade];
  const core = buildRequiredDocumentChecklist(trades, partner, rules).map((r) => r.id);
  const extras = buildEnabledPortalExtraDocs(rules)
    .map((r) => r.id)
    .filter((id): id is PortalExtraRequirementId => (PORTAL_EXTRA_REQUIREMENT_IDS as readonly string[]).includes(id));
  return [...core, ...extras, "other"];
}

/**
 * Labels for the admin modal (checkboxes).
 */
export function getPartnerPortalAllowlistOptions(
  partner: Partner,
  rules?: PartnerDocRuleRow[] | null,
): {
  id: string;
  name: string;
  description: string;
  kind: "core" | "extra";
}[] {
  const trades = partner.trades?.length ? partner.trades : [partner.trade];
  const checklist = buildRequiredDocumentChecklist(trades, partner, rules);
  const core = checklist.map((r: RequiredDocDef) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    kind: "core" as const,
  }));
  const extra = buildEnabledPortalExtraDocs(rules).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    kind: "extra" as const,
  }));
  const hasOther = resolvePartnerOtherEnabled(rules);
  const otherRow = hasOther
    ? [
        {
          id: "other",
          name: "Other document",
          description: "Any other file the partner labels when uploading.",
          kind: "extra" as const,
        },
      ]
    : [];
  return [...core, ...extra.filter((e) => e.id !== "other"), ...otherRow];
}

function resolvePartnerOtherEnabled(rules?: PartnerDocRuleRow[] | null): boolean {
  const extras = buildEnabledPortalExtraDocs(rules);
  return extras.some((e) => e.id === "other") || !rules;
}

export function isAllowedPortalRequirementId(
  partner: Partner,
  id: string,
  rules?: PartnerDocRuleRow[] | null,
): boolean {
  return getPartnerPortalAllowlistIds(partner, rules).includes(id);
}
