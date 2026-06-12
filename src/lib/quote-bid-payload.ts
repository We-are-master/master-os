import { normalizeCalendarDateToYmd } from "@/lib/utils";

/**
 * Optional JSON the partner app can send in `quote_bids.notes` to pre-fill the customer proposal.
 * Plain text notes still work; JSON can be the whole string or prefixed with BID_JSON:
 *
 * **Pricing (optional, Fixfy OS mirrors in proposal lines 1–2 `notes` JSON):**
 * - `labour_pricing` `"hourly"` | `"fixed"` (default fixed). If hourly, set `labour_hours` + `labour_rate` (£/hr) so they × ≈ `labour_cost`.
 * - `materials_pricing` `"unit"` | `"bulk"` (default unit). If unit, optional `materials_quantity` + `materials_partner_unit` (£/unit) so they × ≈ `materials_cost`.
 */
export type PartnerBidProposalPayload = {
  labour_cost?: number;
  materials_cost?: number;
  labour_description?: string;
  materials_description?: string;
  labour_pricing?: "hourly" | "fixed";
  /** Partner hours when `labour_pricing` is hourly. */
  labour_hours?: number;
  /** Partner £/hr when `labour_pricing` is hourly. */
  labour_rate?: number;
  materials_pricing?: "unit" | "bulk";
  /** Line count / units when materials are priced per unit. */
  materials_quantity?: number;
  /** Partner £/unit when materials are priced per unit. */
  materials_partner_unit?: number;
  start_date_option_1?: string;
  start_date_option_2?: string;
  deposit_required?: number;
  scope?: string;
};

const BID_JSON_PREFIX = "BID_JSON:";

/** Max difference allowed between bidAmount and labour + materials (£). */
export const BID_AMOUNT_TOLERANCE = 0.02;

export type ValidatedPartnerBidPayload = PartnerBidProposalPayload & {
  labour_cost: number;
  materials_cost: number;
  labour_pricing: "hourly" | "fixed";
  materials_pricing: "unit" | "bulk";
  start_date_option_1: string;
  start_date_option_2: string;
};

function finiteNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Coerce loose API/form input into a payload object. */
export function normalizePartnerBidPayloadInput(raw: unknown): PartnerBidProposalPayload {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const labourPricing = o.labour_pricing === "hourly" ? "hourly" : o.labour_pricing === "fixed" ? "fixed" : undefined;
  const materialsPricing = o.materials_pricing === "bulk" ? "bulk" : o.materials_pricing === "unit" ? "unit" : undefined;
  return {
    labour_cost: finiteNumber(o.labour_cost) ?? undefined,
    materials_cost: finiteNumber(o.materials_cost) ?? undefined,
    labour_description: bidPayloadTrimmedString(o.labour_description) || undefined,
    materials_description: bidPayloadTrimmedString(o.materials_description) || undefined,
    labour_pricing: labourPricing,
    labour_hours: finiteNumber(o.labour_hours) ?? undefined,
    labour_rate: finiteNumber(o.labour_rate) ?? undefined,
    materials_pricing: materialsPricing,
    materials_quantity: finiteNumber(o.materials_quantity) ?? undefined,
    materials_partner_unit: finiteNumber(o.materials_partner_unit) ?? undefined,
    start_date_option_1: bidPayloadTrimmedString(o.start_date_option_1) || undefined,
    start_date_option_2: bidPayloadTrimmedString(o.start_date_option_2) || undefined,
    deposit_required: finiteNumber(o.deposit_required) ?? undefined,
    scope: bidPayloadTrimmedString(o.scope) || undefined,
  };
}

export function serializePartnerBidPayload(payload: PartnerBidProposalPayload): string {
  return `${BID_JSON_PREFIX}${JSON.stringify(payload)}`;
}

/** Parse structured payload from stored bid notes (alias for clarity in forms). */
export function deserializePartnerBidPayload(notes: string | undefined | null): PartnerBidProposalPayload | null {
  return parseBidProposalFromNotes(notes);
}

export function buildBidNotesJson(
  payload: PartnerBidProposalPayload,
  freeformNotes?: string | null,
): string {
  const json = serializePartnerBidPayload(payload);
  const extra = bidPayloadTrimmedString(freeformNotes);
  if (!extra) return json;
  return `${json}\n\n${extra}`;
}

export function validatePartnerBidPayload(
  raw: PartnerBidProposalPayload,
  bidAmount?: number,
): { ok: true; payload: ValidatedPartnerBidPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const payload = normalizePartnerBidPayloadInput(raw) as PartnerBidProposalPayload;

  const labourCost = finiteNumber(payload.labour_cost);
  if (labourCost == null || labourCost < 0) {
    errors.push("Labour cost is required (enter 0 or more).");
  }

  const materialsCost = finiteNumber(payload.materials_cost);
  if (materialsCost == null || materialsCost < 0) {
    errors.push("Materials cost is required (enter 0 or more).");
  }

  const labourPricing: "hourly" | "fixed" = payload.labour_pricing === "hourly" ? "hourly" : "fixed";
  if (labourPricing === "hourly") {
    const hrs = finiteNumber(payload.labour_hours);
    const rate = finiteNumber(payload.labour_rate);
    if (hrs == null || hrs <= 0) errors.push("Labour hours are required for hourly pricing.");
    if (rate == null || rate <= 0) errors.push("Labour rate (£/hr) is required for hourly pricing.");
  }

  const materialsPricing: "unit" | "bulk" = payload.materials_pricing === "bulk" ? "bulk" : "unit";

  const d1 = normalizeCalendarDateToYmd(bidPayloadTrimmedString(payload.start_date_option_1));
  const d2 = normalizeCalendarDateToYmd(bidPayloadTrimmedString(payload.start_date_option_2));
  if (!d1) errors.push("Start date option 1 is required.");
  if (!d2) errors.push("Start date option 2 is required.");
  if (d1 && d2 && d1 === d2) errors.push("Start date options must be different.");

  if (labourCost != null && materialsCost != null && labourCost + materialsCost <= 0) {
    errors.push("Total bid must be greater than zero.");
  }

  if (bidAmount != null && labourCost != null && materialsCost != null) {
    const sum = Math.round((labourCost + materialsCost) * 100) / 100;
    const amt = Math.round(bidAmount * 100) / 100;
    if (Math.abs(amt - sum) > BID_AMOUNT_TOLERANCE) {
      errors.push(`Bid total must equal labour + materials (£${sum.toFixed(2)}).`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    payload: {
      ...payload,
      labour_cost: labourCost!,
      materials_cost: materialsCost!,
      labour_pricing: labourPricing,
      materials_pricing: materialsPricing,
      start_date_option_1: d1!,
      start_date_option_2: d2!,
    },
  };
}

/** JSON fields may be numbers or other types from partner apps — never call .trim() on unknown. */
export function bidPayloadTrimmedString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

/** Split stored notes into structured payload + optional freeform text. */
export function splitBidNotes(notes: string | undefined | null): {
  payload: PartnerBidProposalPayload | null;
  freeform: string;
} {
  const t = bidPayloadTrimmedString(notes as unknown);
  if (!t) return { payload: null, freeform: "" };
  if (!t.startsWith(BID_JSON_PREFIX)) return { payload: null, freeform: t };
  const jsonSlice = t.slice(BID_JSON_PREFIX.length).trim();
  if (!jsonSlice.startsWith("{")) return { payload: null, freeform: t };
  let depth = 0;
  let end = -1;
  for (let i = 0; i < jsonSlice.length; i++) {
    const ch = jsonSlice[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return { payload: null, freeform: t };
  try {
    const j = JSON.parse(jsonSlice.slice(0, end)) as PartnerBidProposalPayload;
    const freeform = jsonSlice.slice(end).trim();
    return { payload: j && typeof j === "object" ? j : null, freeform };
  } catch {
    return { payload: null, freeform: t };
  }
}

export function parseBidProposalFromNotes(notes: string | undefined | null): PartnerBidProposalPayload | null {
  return splitBidNotes(notes).payload;
}

/** Customer sell = partner labour × (1 + this). */
export const BID_DEFAULT_LABOUR_MARKUP = 0.4;
/** Customer sell = partner materials × (1 + this). */
export const BID_DEFAULT_MATERIALS_MARKUP = 0.25;

/** Default gross margin on sell (40%) when pre-filling customer unit from partner bid / scale baseline. */
export const BID_DEFAULT_MARGIN_ON_SELL = 0.4;

/** Unit sell price = partner unit cost ÷ (1 − margin on sell). */
export function customerUnitSellFromPartnerUnit(partnerUnit: number, marginOnSell = BID_DEFAULT_MARGIN_ON_SELL): number {
  if (!(partnerUnit > 0) || marginOnSell >= 1 || marginOnSell <= 0) return 0;
  return Math.round((partnerUnit / (1 - marginOnSell)) * 100) / 100;
}

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
    const lab = p.labour_pricing === "hourly" ? "Labour (hourly)" : "Labour";
    const mat = p.materials_pricing === "bulk" ? "Materials (bulk)" : "Materials";
    parts.push(`${lab} £${Number(p.labour_cost).toFixed(2)} · ${mat} £${Number(p.materials_cost).toFixed(2)}`);
  } else if (p.labour_cost != null && Number.isFinite(Number(p.labour_cost))) {
    const lab = p.labour_pricing === "hourly" ? "Labour (hourly)" : "Labour";
    parts.push(`${lab} £${Number(p.labour_cost).toFixed(2)}`);
  } else {
    if (p.labour_pricing === "hourly") parts.push("Labour: hourly");
    else if (p.labour_pricing === "fixed") parts.push("Labour: fixed");
    if (p.materials_pricing === "bulk") parts.push("Materials: bulk");
    else if (p.materials_pricing === "unit") parts.push("Materials: unit");
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
