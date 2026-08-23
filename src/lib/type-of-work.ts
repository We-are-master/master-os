import type { CatalogService } from "@/types/database";

/** Canonical label for general repairs / maintenance work (Partners, Requests, Quotes, Jobs). */
export const GENERAL_MAINTENANCE_LABEL = "General Maintenance" as const;

/**
 * Canonical type-of-work names — **must match** rows seeded into `service_catalog`
 * (see migration `174_service_catalog_complete_canonical_types.sql`). The Services
 * admin table is the place to set prices per line; this array is for matching, map
 * colours, and backfill only.
 */
export const CANONICAL_TYPE_OF_WORK_NAMES = [
  "Painter",
  GENERAL_MAINTENANCE_LABEL,
  "Plumber",
  "Electrician",
  "Builder",
  "Carpenter",
  "Cleaning",
  "Gardener",
  "Boiler Service",
  "Electrical Safety Report",
  "Appliance Testing",
  "Gas Safety Certificate",
  "Fire Risk Assessment",
  "Fire Alarm Certificate",
  "Emergency Lighting Certificate",
  "Fire Extinguisher Service",
] as const;

/** Compliance / certificate SKUs — partner report form uses the certificate template. */
export const CERTIFICATE_TYPE_OF_WORK_NAMES = [
  "Boiler Service",
  "Electrical Safety Report",
  "Appliance Testing",
  "Gas Safety Certificate",
  "Fire Risk Assessment",
  "Fire Alarm Certificate",
  "Emergency Lighting Certificate",
  "Fire Extinguisher Service",
] as const;

const CERTIFICATE_MATCH_KEYWORDS = [
  "eicr",
  "pat testing",
  "portable appliance",
  "gas safety",
  "cp12",
  "fire risk",
  "fire alarm",
  "emergency lighting",
  "fire extinguisher",
  "boiler service",
  // EPC entrou em 17/08/2026: o JOB-9412 "(EPC) Energy Performance
  // Certificate" não casava com nada e caía em general — mesmo buraco que
  // mandou o EICR do 9406 pro template de limpeza.
  "epc",
  "energy performance",
];

/** True when the label/title is a compliance certificate SKU (not general maintenance). */
export function isCertificateTypeOfWork(value?: string | null): boolean {
  const raw = (value ?? "").trim();
  if (!raw) return false;
  const norm = normalizeTypeOfWork(raw);
  if (
    norm &&
    CERTIFICATE_TYPE_OF_WORK_NAMES.some((name) => name.toLowerCase() === norm.toLowerCase())
  ) {
    return true;
  }
  const lower = raw.toLowerCase();
  return CERTIFICATE_MATCH_KEYWORDS.some((k) => lower.includes(k));
}

/** @deprecated Use {@link CANONICAL_TYPE_OF_WORK_NAMES}; alias kept for older imports. */
export const TYPE_OF_WORK_OPTIONS = CANONICAL_TYPE_OF_WORK_NAMES;

/** Exact legacy labels (UI + DB) → canonical TYPE_OF_WORK string. */
const TYPE_OF_WORK_ALIASES: Record<string, string> = {
  "general maintenance": GENERAL_MAINTENANCE_LABEL,
  handyman: GENERAL_MAINTENANCE_LABEL,
  gardener: "Gardener",
  garderner: "Gardener",
  boiler: "Boiler Service",
  "boiler service": "Boiler Service",
  eicr: "Electrical Safety Report",
  "electrical installation condition report": "Electrical Safety Report",
  "electrical installation condition report (eicr)": "Electrical Safety Report",
  "pat testing": "Appliance Testing",
  "portable appliance testing": "Appliance Testing",
  "portable appliance testing (pat)": "Appliance Testing",
  "pat eicr": "Appliance Testing",
  "gas safety certificate": "Gas Safety Certificate",
  "gas safety certificate (gsc)": "Gas Safety Certificate",
  "fire risk assessment": "Fire Risk Assessment",
  "fire risk assessment (fra)": "Fire Risk Assessment",
  "fire extinguisher service": "Fire Extinguisher Service",
  "fire extinguisher service (fes)": "Fire Extinguisher Service",
  // Rename de 23/08/2026: o type of work passou a ir pro cliente, entao as
  // siglas sairam do nome. As chaves antigas ficam aqui pra sempre: job velho,
  // assunto de ticket do Zendesk e email da Housekeep continuam escrevendo
  // "(EOT) End of Tenancy", e todos precisam cair no nome novo.
  "(eicr) electrical installation condition report": "Electrical Safety Report",
  "electrical safety report": "Electrical Safety Report",
  "electrical safety check": "Electrical Safety Report",
  "electrical safety certificate": "Electrical Safety Report",
  "(pat) portable appliance testing": "Appliance Testing",
  "appliance testing": "Appliance Testing",
  "(gsc) gas safety certificate": "Gas Safety Certificate",
  "(cp12)gas safety check": "Gas Safety Check",
  "(cp12) gas safety check": "Gas Safety Check",
  "gas safety check": "Gas Safety Check",
  cp12: "Gas Safety Check",
  "(fra) fire risk assessment": "Fire Risk Assessment",
  "(fes) fire extinguisher service": "Fire Extinguisher Service",
  "(fac) fire alarm certificate": "Fire Alarm Certificate",
  "fire alarm certificate": "Fire Alarm Certificate",
  "(epc) energy performance certificate": "Energy Performance Certificate",
  "energy performance certificate": "Energy Performance Certificate",
  epc: "Energy Performance Certificate",
  "(eot) end of tenancy": "End of Tenancy Clean",
  "(eot) end of tenancy cleaning": "End of Tenancy Clean",
  "end of tenancy": "End of Tenancy Clean",
  "end of tenancy cleaning": "End of Tenancy Clean",
  "end of tenancy clean": "End of Tenancy Clean",
  eot: "End of Tenancy Clean",
  "(ab) after builders cleaning": "After Builders Clean",
  "after builders cleaning": "After Builders Clean",
  "after builders clean": "After Builders Clean",
  "(dc) deep cleaning": "Deep Clean",
  "gas safety check (cp12)": "Gas Safety Check",
  "(ams) asbestos management survey": "Asbestos Management Survey",
  "asbestos management survey": "Asbestos Management Survey",
  "(lra) legionella risk assessment": "Legionella Risk Assessment",
  "legionella risk assessment": "Legionella Risk Assessment",
  "(fdi) fire door inspection": "Fire Door Inspection",
  "fire door inspection": "Fire Door Inspection",
  "(epc-c) commercial energy performance certificate": "Commercial Energy Performance Certificate",
  "commercial energy performance certificate": "Commercial Energy Performance Certificate",
  "deep cleaning": "Deep Clean",
  "deep clean": "Deep Clean",
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

/**
 * Labels for “type of work” pickers: **active Services catalog only**, plus any
 * `current` value so existing jobs/quotes with legacy titles still appear when editing.
 * Add or edit services in Settings (Service catalog tab) — there is no built-in static list anymore.
 */
export function typeOfWorkLabelsFromCatalog(
  catalog: Pick<CatalogService, "name">[],
  current?: string | null,
): string[] {
  const names = catalog.map((c) => c.name?.trim()).filter(Boolean) as string[];
  if (names.length > 0) {
    return mergeTypeOfWorkOptions([...names, current]).sort((a, b) => a.localeCompare(b));
  }
  return mergeTypeOfWorkOptions([current]).sort((a, b) => a.localeCompare(b));
}

/** Resolve catalog row id from a picker label (exact name, then normalized type-of-work). */
export function catalogServiceIdForTypeOfWorkLabel(
  label: string,
  catalog: Pick<CatalogService, "id" | "name">[],
): string | null {
  const t = label?.trim();
  if (!t || catalog.length === 0) return null;
  const exact = catalog.find((s) => (s.name ?? "").trim() === t);
  if (exact) return exact.id;
  const n = normalizeTypeOfWork(t);
  if (!n) return null;
  const byNorm = catalog.find((s) => normalizeTypeOfWork(s.name) === n);
  return byNorm?.id ?? null;
}

/** @deprecated Prefer {@link typeOfWorkLabelsFromCatalog} with rows from `listCatalogServicesForPicker`. */
export function withTypeOfWorkFallback(current?: string | null): string[] {
  return typeOfWorkLabelsFromCatalog([], current);
}
