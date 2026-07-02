import type { Partner } from "@/types/database";

/** Stored on `partners.partner_status_reasons` (and optional `other:free text`). */
export const PARTNER_REASON_CODES = [
  "missing_documents",
  "low_compliance_score",
  "expired_docs",
  "on_break",
  "was_activated",
] as const;

export type PartnerReasonCode = (typeof PARTNER_REASON_CODES)[number];

const LABELS: Record<string, string> = {
  missing_documents: "Missing Documents",
  low_compliance_score: "Low Compliance Score",
  expired_docs: "Expired Docs",
  on_break: "On Break",
  force_activated: "Force Activated",
  was_activated: "Activated",
};

/** Human-readable label for a stored reason string (supports `other:…`). */
export function partnerReasonLabel(code: string): string {
  if (code.startsWith("other:")) {
    const rest = code.slice(6).trim();
    return rest || "Other";
  }
  return LABELS[code] ?? code.replace(/_/g, " ");
}

export function mergeUniqueReasons(existing: string[] | null | undefined, add: string[]): string[] {
  const s = new Set<string>([...(existing ?? []).filter(Boolean), ...add.filter(Boolean)]);
  return Array.from(s);
}

/** Only **active** partners may be invited to bid or assigned on jobs/quotes/requests. */
export function isPartnerEligibleForWork(p: Pick<Partner, "status">): boolean {
  return p.status === "active";
}

/** Inactive-style directory stages (not eligible for invites). */
export function isPartnerInactiveStage(p: Pick<Partner, "status">): boolean {
  return p.status === "inactive" || p.status === "on_break";
}

const ACTIVATION_MIN = 95;

export type PartnerAutoFlags = {
  missingMandatoryDocs: boolean;
  hasExpiredDocs: boolean;
  complianceBelowThreshold: boolean;
};

/** Directory filters: onboarding tab includes partners still in funnel + post-activation gaps. */
export const PARTNER_ONBOARDING_STAGE_STATUSES = ["onboarding", "needs_attention"] as const;

/** Whether this partner has been through at least one staff activation. */
export function partnerWasActivatedOnce(
  p: Pick<Partner, "verified" | "partner_status_reasons" | "status">,
): boolean {
  const reasons = p.partner_status_reasons ?? [];
  if (reasons.includes("was_activated") || reasons.includes("force_activated")) return true;
  if (p.verified) return true;
  return p.status === "active" || p.status === "needs_attention";
}

export function computeAutoReasonCodes(flags: PartnerAutoFlags): string[] {
  const out: string[] = [];
  if (flags.missingMandatoryDocs) out.push("missing_documents");
  if (flags.hasExpiredDocs) out.push("expired_docs");
  if (flags.complianceBelowThreshold) out.push("low_compliance_score");
  return out;
}

/**
 * When compliance flags require attention, merge reason codes.
 * - **Onboarding** stays `onboarding` until someone activates (even if docs are missing).
 * - **Active** → `needs_attention` when issues appear after activation.
 * - **Needs attention** without a prior activation falls back to `onboarding`.
 * Does not change `inactive` / `on_break` partners.
 */
export function deriveAutoStatusAndReasons(
  partner: Pick<Partner, "status" | "partner_status_reasons" | "verified">,
  autoCodes: string[],
): { status: Partner["status"]; partner_status_reasons: string[] } {
  const current = partner.status;
  const merged = mergeUniqueReasons(partner.partner_status_reasons, autoCodes);
  const isForceActivated = merged.includes("force_activated");
  /** Legacy top-level `on_break` is treated like inactive for automation (reason stays in `partner_status_reasons`). */
  if (current === "inactive" || current === "on_break") {
    return { status: current, partner_status_reasons: partner.partner_status_reasons ?? [] };
  }
  if (current === "needs_attention" && !partnerWasActivatedOnce(partner)) {
    return { status: "onboarding", partner_status_reasons: merged.filter((r) => r !== "was_activated") };
  }
  // Manual force activation wins over compliance automation while partner remains non-inactive.
  if (isForceActivated) {
    return { status: "active", partner_status_reasons: merged };
  }
  if (autoCodes.length === 0) {
    return { status: current, partner_status_reasons: partner.partner_status_reasons ?? [] };
  }
  if (current === "onboarding") {
    return { status: "onboarding", partner_status_reasons: merged };
  }
  if (current === "active") {
    return { status: "needs_attention", partner_status_reasons: merged };
  }
  if (current === "needs_attention") {
    return { status: "needs_attention", partner_status_reasons: merged };
  }
  return { status: current, partner_status_reasons: merged };
}

export function shouldForceActivateAck(complianceScore: number): boolean {
  return complianceScore < ACTIVATION_MIN;
}
