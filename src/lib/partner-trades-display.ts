import { filterCatalogServicesForPartner } from "@/lib/catalog-trade-ids";
import { tradeCategoryCatalogRows } from "@/lib/partner-trade-categories";
import {
  GENERAL_MAINTENANCE_LABEL,
  normalizeTypeOfWork,
  typeOfWorkLabelsFromCatalog,
} from "@/lib/type-of-work";
import type { CatalogService, Partner } from "@/types/database";

export type PartnerTradeFields = Pick<Partner, "trades" | "catalog_service_ids"> & {
  trade?: string | null;
};

const LEGACY_TRADE_ALIASES: Record<string, string> = {
  electrical: "Electrician",
  plumbing: "Plumber",
  painting: "Painter",
  carpentry: "Carpenter",
  hvac: GENERAL_MAINTENANCE_LABEL,
  handyman: GENERAL_MAINTENANCE_LABEL,
};

/** Legacy `partner.trade` / DB may still say "HVAC"; never show that label in UI. */
export function isHiddenTradeLabel(t: string): boolean {
  return String(t).trim().toLowerCase() === "hvac";
}

function catalogLabels(catalog: readonly CatalogService[]): readonly string[] {
  return catalog.length > 0 ? typeOfWorkLabelsFromCatalog([...catalog]) : [];
}

export function normalizeTradeNameForCatalog(
  value: string | null | undefined,
  catalog: readonly CatalogService[],
): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const activeLabels = catalogLabels(catalog);
  for (const p of activeLabels) {
    if (p.toLowerCase() === raw.toLowerCase()) return p;
  }
  const legacy = LEGACY_TRADE_ALIASES[raw.toLowerCase()];
  if (legacy) {
    for (const p of activeLabels) {
      if (p.toLowerCase() === legacy.toLowerCase()) return p;
    }
    return legacy;
  }
  const fromWork = normalizeTypeOfWork(raw);
  if (fromWork) {
    for (const p of activeLabels) {
      if (p.toLowerCase() === fromWork.toLowerCase()) return p;
    }
    return fromWork;
  }
  return null;
}

function normalizeTradesFromStrings(
  values: Array<string | null | undefined>,
  catalog: readonly CatalogService[],
): string[] {
  const byLower = new Map<string, string>();
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || isHiddenTradeLabel(trimmed)) continue;
    const normalized = normalizeTradeNameForCatalog(trimmed, catalog);
    const label = normalized ?? trimmed;
    const key = label.toLowerCase();
    if (!byLower.has(key)) byLower.set(key, label);
  }
  const activeLabels = catalogLabels(catalog);
  const fallback = activeLabels[0] ?? GENERAL_MAINTENANCE_LABEL;
  return byLower.size > 0 ? Array.from(byLower.values()) : [fallback];
}

/**
 * Enabled trade category labels — same source as Trades & skills tab
 * (`catalog_service_ids` ∪ label-matched catalog rows), primary first, then catalog sort_order.
 */
export function getPartnerEnabledTrades(
  partner: PartnerTradeFields,
  catalog: readonly CatalogService[],
): string[] {
  if (!catalog.length) {
    const tradeList = partner.trades?.length
      ? partner.trades
      : partner.trade?.trim()
        ? [partner.trade]
        : [];
    return normalizeTradesFromStrings(tradeList, catalog);
  }

  const offered = filterCatalogServicesForPartner(
    [...catalog],
    partner as Pick<Partner, "catalog_service_ids" | "trades" | "trade">,
  );
  const categoryRows = tradeCategoryCatalogRows(offered);
  if (categoryRows.length === 0) {
    const tradeList = partner.trades?.length
      ? partner.trades
      : partner.trade?.trim()
        ? [partner.trade]
        : [];
    return normalizeTradesFromStrings(tradeList, catalog);
  }

  const primaryLabel = (partner.trades?.[0] ?? partner.trade ?? "").trim();
  const primaryLower = primaryLabel.toLowerCase();

  const sorted = [...categoryRows].sort((a, b) => {
    const aName = (a.name ?? "").trim();
    const bName = (b.name ?? "").trim();
    const aIsPrimary = Boolean(primaryLower && aName.toLowerCase() === primaryLower);
    const bIsPrimary = Boolean(primaryLower && bName.toLowerCase() === primaryLower);
    if (aIsPrimary !== bIsPrimary) return aIsPrimary ? -1 : 1;
    const ao = a.sort_order ?? 0;
    const bo = b.sort_order ?? 0;
    if (ao !== bo) return ao - bo;
    return aName.localeCompare(bName);
  });

  return normalizeTradesFromStrings(
    sorted.map((r) => r.name),
    catalog,
  );
}

/** Normalize raw trade strings against the catalog (edit forms). */
export function normalizePartnerTradeLabels(
  values: Array<string | null | undefined>,
  catalog: readonly CatalogService[],
): string[] {
  return normalizeTradesFromStrings(values, catalog).filter((t) => !isHiddenTradeLabel(t));
}

/** Trades for UI (drops HVAC). Prefer catalog-backed enabled trades when catalogue is loaded. */
export function partnerTradesForDisplay(
  partner: PartnerTradeFields,
  catalog?: readonly CatalogService[],
): string[] {
  return getPartnerEnabledTrades(partner, catalog ?? []).filter((t) => !isHiddenTradeLabel(t));
}

/** One-line label: primary trade, or `Primary +N` when multiple enabled trades. */
export function formatPartnerPrimaryTradeLabel(
  partner: PartnerTradeFields,
  catalog: readonly CatalogService[],
): string {
  const trades = partnerTradesForDisplay(partner, catalog);
  if (trades.length === 0) return GENERAL_MAINTENANCE_LABEL;
  const primary = trades[0]!;
  const extra = trades.length - 1;
  return extra > 0 ? `${primary} +${extra}` : primary;
}

export function formatPartnerTradeCoverageLine(
  partner: PartnerTradeFields,
  catalog: readonly CatalogService[],
  coverageSummary: string,
): string {
  const tradeLabel = formatPartnerPrimaryTradeLabel(partner, catalog);
  return coverageSummary ? `${tradeLabel} · ${coverageSummary}` : tradeLabel;
}

export function tradeMatchesColumnLabel(
  trade: string,
  columnLabel: string,
  catalog: readonly CatalogService[],
): boolean {
  const normalized =
    normalizeTradeNameForCatalog(trade, catalog) ??
    normalizeTypeOfWork(trade) ??
    trade.trim();
  return normalized.toLowerCase() === columnLabel.trim().toLowerCase();
}
