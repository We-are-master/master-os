import type { Partner } from "@/types/database";
import { buildRequiredDocumentChecklist, type RequiredDocDef } from "@/lib/partner-required-docs";

/** Extra portal-only requirement ids (not from compliance checklist). */
export const PORTAL_EXTRA_REQUIREMENT_IDS = ["dbs", "other"] as const;
export type PortalExtraRequirementId = (typeof PORTAL_EXTRA_REQUIREMENT_IDS)[number];

/**
 * All requirement ids that may appear on the partner portal for this partner
 * (compliance checklist + optional DBS + “other”).
 */
export function getPartnerPortalAllowlistIds(partner: Partner): string[] {
  const trades = partner.trades?.length ? partner.trades : [partner.trade];
  const core = buildRequiredDocumentChecklist(trades, partner).map((r) => r.id);
  return [...core, ...PORTAL_EXTRA_REQUIREMENT_IDS];
}

/**
 * Labels for the admin modal (checkboxes).
 */
export function getPartnerPortalAllowlistOptions(partner: Partner): {
  id: string;
  name: string;
  description: string;
  kind: "core" | "extra";
}[] {
  const trades = partner.trades?.length ? partner.trades : [partner.trade];
  const checklist = buildRequiredDocumentChecklist(trades, partner);
  const core = checklist.map((r: RequiredDocDef) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    kind: "core" as const,
  }));
  const extra = [
    {
      id: "dbs",
      name: "DBS (Disclosure and Barring)",
      description: "Optional — basic DBS certificate if applicable.",
      kind: "extra" as const,
    },
    {
      id: "other",
      name: "Other document",
      description: "Any other file the partner labels when uploading.",
      kind: "extra" as const,
    },
  ];
  return [...core, ...extra];
}

export function isAllowedPortalRequirementId(partner: Partner, id: string): boolean {
  return getPartnerPortalAllowlistIds(partner).includes(id);
}
