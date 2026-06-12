/** Partner Cash Out — extra (add) and deduction types (Settings → Setup, job money drawer). */

export type PartnerExtraPresetRow = {
  id: string;
  label: string;
  /** Value stored on `job_extra_entries.extra_type` and passed to money actions. */
  extraType: string;
};

export const MAX_PARTNER_EXTRA_PRESET_LABEL_LEN = 80;

export const DEFAULT_PARTNER_EXTRA_PRESETS: PartnerExtraPresetRow[] = [
  { id: "labour", label: "Labour", extraType: "Labour" },
  { id: "ccz", label: "CCZ", extraType: "CCZ" },
  { id: "parking", label: "Parking", extraType: "Parking" },
  { id: "materials", label: "Materials", extraType: "Materials" },
  { id: "other", label: "Other", extraType: "Other" },
];

export const DEFAULT_PARTNER_DEDUCTION_PRESETS: PartnerExtraPresetRow[] = [
  {
    id: "discount_labour",
    label: "Discount — labour (less to pay partner)",
    extraType: "Discount — labour",
  },
  {
    id: "discount_materials",
    label: "Discount — materials (less materials cost)",
    extraType: "Discount — materials",
  },
  {
    id: "cancellation_fee",
    label: "Cancellation fee",
    extraType: "Discount — cancellation fee",
  },
  {
    id: "discount_other",
    label: "Other discount",
    extraType: "Discount — other",
  },
];

export function isPartnerCancellationFeeExtraType(extraType: string | null | undefined): boolean {
  const u = (extraType ?? "").trim().toUpperCase();
  return u.includes("CANCELLATION") && u.includes("FEE");
}

function normalizePresetList(
  raw: unknown,
  defaults: PartnerExtraPresetRow[],
): PartnerExtraPresetRow[] {
  const defaultById = new Map(defaults.map((d) => [d.id, d] as const));
  const bySavedOrder: PartnerExtraPresetRow[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rid = typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id.trim() : "";
      const canon = defaultById.get(rid);
      if (!rid || !canon || seen.has(rid)) continue;
      seen.add(rid);
      let label =
        typeof (item as { label?: unknown }).label === "string" ? (item as { label: string }).label.trim() : "";
      if (!label) label = canon.label;
      label = label.slice(0, MAX_PARTNER_EXTRA_PRESET_LABEL_LEN);
      bySavedOrder.push({ id: rid, label, extraType: canon.extraType });
    }
  }

  const merged: PartnerExtraPresetRow[] = [...bySavedOrder];
  for (const canon of defaults) {
    if (!seen.has(canon.id)) merged.push({ ...canon });
  }
  return merged;
}

export function normalizePartnerExtraPresets(raw: unknown): PartnerExtraPresetRow[] {
  return normalizePresetList(raw, DEFAULT_PARTNER_EXTRA_PRESETS);
}

export function normalizePartnerDeductionPresets(raw: unknown): PartnerExtraPresetRow[] {
  return normalizePresetList(raw, DEFAULT_PARTNER_DEDUCTION_PRESETS);
}

export function resolvePartnerExtraPresets(setup?: {
  partner_extra_presets?: PartnerExtraPresetRow[];
} | null): PartnerExtraPresetRow[] {
  return normalizePartnerExtraPresets(setup?.partner_extra_presets ?? null);
}

export function resolvePartnerDeductionPresets(setup?: {
  partner_deduction_presets?: PartnerExtraPresetRow[];
} | null): PartnerExtraPresetRow[] {
  return normalizePartnerDeductionPresets(setup?.partner_deduction_presets ?? null);
}

export function partnerPresetSelectOptions(
  presets: PartnerExtraPresetRow[],
): { value: string; label: string }[] {
  return presets.map((p) => ({ value: p.extraType, label: p.label }));
}

/** Add-only partner types for linked client extra (no discounts). */
export function partnerAddOnlySelectOptions(
  presets: PartnerExtraPresetRow[],
): { value: string; label: string }[] {
  return partnerPresetSelectOptions(presets);
}
