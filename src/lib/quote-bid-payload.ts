/**
 * Optional JSON the partner app can send in `quote_bids.notes` to pre-fill the customer proposal.
 * Plain text notes still work; JSON can be the whole string or prefixed with BID_JSON:
 */
export type PartnerBidProposalPayload = {
  labour_cost?: number;
  materials_cost?: number;
  labour_description?: string;
  materials_description?: string;
  start_date_option_1?: string;
  start_date_option_2?: string;
  deposit_required?: number;
  scope?: string;
};

const BID_JSON_PREFIX = "BID_JSON:";

/** JSON fields may be numbers or other types from partner apps — never call .trim() on unknown. */
export function bidPayloadTrimmedString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

export function parseBidProposalFromNotes(notes: string | undefined | null): PartnerBidProposalPayload | null {
  const t = bidPayloadTrimmedString(notes as unknown);
  if (!t) return null;
  const jsonSlice = t.startsWith(BID_JSON_PREFIX) ? t.slice(BID_JSON_PREFIX.length).trim() : t;
  if (!jsonSlice.startsWith("{")) return null;
  try {
    const j = JSON.parse(jsonSlice) as PartnerBidProposalPayload;
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
}

/** Customer sell = partner labour × (1 + this). */
export const BID_DEFAULT_LABOUR_MARKUP = 0.4;
/** Customer sell = partner materials × (1 + this). */
export const BID_DEFAULT_MATERIALS_MARKUP = 0.25;

export function splitBidPartnerCosts(bidAmount: number, payload: PartnerBidProposalPayload | null): { labour: number; materials: number } {
  const l = payload?.labour_cost;
  const m = payload?.materials_cost;
  if (l != null && Number.isFinite(Number(l)) && m != null && Number.isFinite(Number(m))) {
    return { labour: Math.max(0, Number(l)), materials: Math.max(0, Number(m)) };
  }
  if (l != null && Number.isFinite(Number(l))) {
    return { labour: Math.max(0, Number(l)), materials: Math.max(0, bidAmount - Number(l)) };
  }
  return { labour: Math.max(0, bidAmount), materials: 0 };
}

/** Human-readable summary when `notes` is JSON payload; otherwise returns `null` (show plain notes). */
export function summarizeBidProposalNotes(notes: string | undefined | null): string | null {
  const p = parseBidProposalFromNotes(notes);
  if (!p) return null;
  const parts: string[] = [];
  if (p.labour_cost != null && Number.isFinite(Number(p.labour_cost)) && p.materials_cost != null && Number.isFinite(Number(p.materials_cost))) {
    parts.push(`Labour £${Number(p.labour_cost).toFixed(2)} · Materials £${Number(p.materials_cost).toFixed(2)}`);
  } else if (p.labour_cost != null && Number.isFinite(Number(p.labour_cost))) {
    parts.push(`Labour £${Number(p.labour_cost).toFixed(2)}`);
  }
  if (p.deposit_required != null && Number.isFinite(Number(p.deposit_required)) && Number(p.deposit_required) > 0) {
    parts.push(`Deposit £${Number(p.deposit_required).toFixed(2)}`);
  }
  const d1 = bidPayloadTrimmedString(p.start_date_option_1).slice(0, 10);
  const d2 = bidPayloadTrimmedString(p.start_date_option_2).slice(0, 10);
  if (d1) parts.push(`Start A: ${d1}`);
  if (d2) parts.push(`Start B: ${d2}`);
  const scopeStr = bidPayloadTrimmedString(p.scope);
  if (scopeStr) {
    parts.push(scopeStr.length > 120 ? `${scopeStr.slice(0, 120)}…` : scopeStr);
  }
  return parts.length ? parts.join(" · ") : null;
}
