import type { CatalogService } from "@/types/database";
import { isCatalogTradeCategoryLabel } from "@/lib/partner-trade-categories";
import { isCertificateTypeOfWork } from "@/lib/type-of-work";
import type { ServicePricingView } from "@/lib/services-pricing-display";

export type CatalogServiceCategory = "trades" | "certificates" | "cleaning" | "other";

export type CatalogCategoryFilter = "all" | CatalogServiceCategory;

export const CATALOG_CATEGORY_ORDER: CatalogServiceCategory[] = [
  "trades",
  "certificates",
  "cleaning",
  "other",
];

export const CATALOG_CATEGORY_LABELS: Record<CatalogServiceCategory, string> = {
  trades: "Trades",
  certificates: "Certificates",
  cleaning: "Cleaning",
  other: "Other",
};

const CLEANING_PREFIXES = ["(ab)", "(dc)", "(eot)"];

const CERTIFICATE_PREFIXES = [
  "(gsc)",
  "(eicr)",
  "(pat)",
  "(fra)",
  "(fes)",
  "(epc)",
  "(fe)",
];

const CLEANING_KEYWORDS = [
  "clean",
  "tenancy",
  "end of tenancy",
  "after builders",
  "deep clean",
  "domestic clean",
  "commercial clean",
];

const CERTIFICATE_KEYWORDS = [
  "fire alarm",
  "emergency lighting",
  "boiler service",
  "energy performance",
];

function normalizedName(name: string | null | undefined): string {
  return (name ?? "").trim();
}

function bracketPrefix(name: string): string | null {
  const match = name.match(/^\(([^)]+)\)/i);
  return match ? match[1].toLowerCase() : null;
}

function hasCleaningPrefix(name: string): boolean {
  const lower = name.toLowerCase();
  return CLEANING_PREFIXES.some((p) => lower.startsWith(p));
}

function hasCertificatePrefix(name: string): boolean {
  const lower = name.toLowerCase();
  return CERTIFICATE_PREFIXES.some((p) => lower.startsWith(p));
}

function hasCleaningKeyword(name: string): boolean {
  const lower = name.toLowerCase();
  return CLEANING_KEYWORDS.some((k) => lower.includes(k));
}

function hasCertificateKeyword(name: string): boolean {
  const lower = name.toLowerCase();
  return CERTIFICATE_KEYWORDS.some((k) => lower.includes(k));
}

function isCleaningCategoryName(name: string): boolean {
  const n = normalizedName(name);
  if (!n) return false;
  if (n.toLowerCase() === "cleaning") return true;
  if (hasCleaningPrefix(n)) return true;
  if (hasCleaningKeyword(n)) return true;
  const prefix = bracketPrefix(n);
  if (prefix && ["ab", "dc", "eot"].includes(prefix)) return true;
  return false;
}

function isCertificateCategoryName(name: string): boolean {
  const n = normalizedName(name);
  if (!n) return false;
  if (isCertificateTypeOfWork(n)) return true;
  if (hasCertificatePrefix(n)) return true;
  if (hasCertificateKeyword(n)) return true;
  const prefix = bracketPrefix(n);
  if (
    prefix &&
    ["gsc", "eicr", "pat", "fra", "fes", "epc", "fe"].includes(prefix)
  ) {
    return true;
  }
  return false;
}

/** Resolve catalog row category from service name heuristics. */
export function resolveCatalogServiceCategory(
  service: Pick<CatalogService, "name">,
): CatalogServiceCategory {
  const name = normalizedName(service.name);
  if (!name) return "other";

  if (isCleaningCategoryName(name)) return "cleaning";
  if (isCertificateCategoryName(name)) return "certificates";
  if (isCatalogTradeCategoryLabel(name)) return "trades";
  return "other";
}

export function groupCatalogServicesByCategory<T extends Pick<CatalogService, "name">>(
  services: readonly T[],
): Map<CatalogServiceCategory, T[]> {
  const map = new Map<CatalogServiceCategory, T[]>(
    CATALOG_CATEGORY_ORDER.map((c) => [c, []]),
  );
  for (const service of services) {
    const category = resolveCatalogServiceCategory(service);
    map.get(category)!.push(service);
  }
  return map;
}

export function filterViewsByCategory(
  views: ServicePricingView[],
  category: CatalogCategoryFilter,
): ServicePricingView[] {
  if (category === "all") return views;
  return views.filter((v) => resolveCatalogServiceCategory(v.service) === category);
}

export function groupViewsByCategory(
  views: ServicePricingView[],
): Map<CatalogServiceCategory, ServicePricingView[]> {
  const map = new Map<CatalogServiceCategory, ServicePricingView[]>(
    CATALOG_CATEGORY_ORDER.map((c) => [c, []]),
  );
  for (const view of views) {
    const category = resolveCatalogServiceCategory(view.service);
    map.get(category)!.push(view);
  }
  return map;
}
