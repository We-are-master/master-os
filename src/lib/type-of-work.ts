/** Canonical label for general repairs / maintenance work (Partners, Requests, Quotes, Jobs). */
export const GENERAL_MAINTENANCE_LABEL = "General Maintenance" as const;

export const TYPE_OF_WORK_OPTIONS = [
  "Painter",
  GENERAL_MAINTENANCE_LABEL,
  "Plumber",
  "Electrician",
  "Builder",
  "Carpenter",
  "Cleaning",
  "EICR",
  "PAT EICR",
  "PAT Testing",
  "Gas Safety Certificate",
  "Fire Risk Assessment",
  "Fire Alarm Certificate",
  "Emergency Lighting Certificate",
  "Fire Extinguisher Service",
] as const;

/** Exact legacy labels (UI + DB) → canonical TYPE_OF_WORK string. */
const TYPE_OF_WORK_ALIASES: Record<string, string> = {
  "general maintenance": GENERAL_MAINTENANCE_LABEL,
  handyman: GENERAL_MAINTENANCE_LABEL,
};

/**
 * Canonical type-of-work / trade label for storage and display.
 * Legacy DB values and free text may still say “handyman”; they are merged into {@link GENERAL_MAINTENANCE_LABEL}
 * without dropping the rest of the phrase (e.g. title suffixes).
 */
export function normalizeTypeOfWork(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const alias = TYPE_OF_WORK_ALIASES[lower];
  if (alias) return alias;
  const replaced = raw
    .replace(/\bhandyman\b/gi, GENERAL_MAINTENANCE_LABEL)
    .replace(/\s{2,}/g, " ")
    .trim();
  return replaced;
}

export function mergeTypeOfWorkOptions(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeTypeOfWork(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function withTypeOfWorkFallback(current?: string | null): string[] {
  const base = [...TYPE_OF_WORK_OPTIONS];
  const value = normalizeTypeOfWork(current);
  if (!value) return base;
  return mergeTypeOfWorkOptions([value, ...base]);
}
