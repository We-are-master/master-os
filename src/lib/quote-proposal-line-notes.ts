import { bidPayloadTrimmedString } from "@/lib/quote-bid-payload";

/** Stored in `quote_line_items.notes` for lines 0–1 (partner app ↔ Master OS). */
export const PROPOSAL_LINE_META_V = 1 as const;

/** Mirrors partner submit: labour hourly vs fixed; materials unit vs bulk. */
export type PartnerLinePricingMode = "hourly" | "fixed" | "unit" | "bulk";

export type ProposalLineMetaV1 = {
  v: typeof PROPOSAL_LINE_META_V;
  partnerPricing: PartnerLinePricingMode;
  hint?: string;
};

function isPartnerLinePricingMode(x: unknown): x is PartnerLinePricingMode {
  return x === "hourly" || x === "fixed" || x === "unit" || x === "bulk";
}

export function parseProposalLineNotes(raw: string | undefined | null): {
  meta: ProposalLineMetaV1 | null;
  legacyPlain: string;
} {
  const t = bidPayloadTrimmedString(raw);
  if (!t) return { meta: null, legacyPlain: "" };
  if (!t.startsWith("{")) return { meta: null, legacyPlain: t };
  try {
    const j = JSON.parse(t) as Partial<ProposalLineMetaV1>;
    if (j?.v === PROPOSAL_LINE_META_V && isPartnerLinePricingMode(j.partnerPricing)) {
      const hint = bidPayloadTrimmedString(j.hint as unknown);
      return {
        meta: {
          v: PROPOSAL_LINE_META_V,
          partnerPricing: j.partnerPricing,
          ...(hint ? { hint } : {}),
        },
        legacyPlain: "",
      };
    }
  } catch {
    /* not JSON meta */
  }
  return { meta: null, legacyPlain: t };
}

export function stringifyProposalLineNotes(meta: ProposalLineMetaV1): string {
  const o: Record<string, unknown> = { v: PROPOSAL_LINE_META_V, partnerPricing: meta.partnerPricing };
  if (meta.hint?.trim()) o.hint = meta.hint.trim();
  return JSON.stringify(o);
}

export function defaultPartnerPricingForLineIndex(idx: number): PartnerLinePricingMode {
  return idx === 0 ? "fixed" : "unit";
}

export function proposalLineHintDisplay(parsed: ReturnType<typeof parseProposalLineNotes>): string {
  if (parsed.meta?.hint) return parsed.meta.hint;
  return parsed.legacyPlain;
}

export function buildNotesWithPricing(
  idx: number,
  existingNotes: string | undefined,
  patch: Partial<Pick<ProposalLineMetaV1, "partnerPricing" | "hint">>,
): string {
  const parsed = parseProposalLineNotes(existingNotes);
  const pricing = patch.partnerPricing ?? parsed.meta?.partnerPricing ?? defaultPartnerPricingForLineIndex(idx);
  const hint =
    patch.hint !== undefined ? patch.hint : proposalLineHintDisplay(parsed);
  const trimmed = bidPayloadTrimmedString(hint as unknown);
  return stringifyProposalLineNotes({
    v: PROPOSAL_LINE_META_V,
    partnerPricing: pricing,
    ...(trimmed ? { hint: trimmed } : {}),
  });
}
