import {
  CATALOG_CATEGORY_LABELS,
  CATALOG_CATEGORY_ORDER,
  groupViewsByCategory,
  resolveCatalogServiceCategory,
  type CatalogServiceCategory,
} from "@/lib/catalog-service-categories";
import {
  buildAllServicePricingViews,
  type PricingLineRow,
  type ServicePricingView,
} from "@/lib/services-pricing-display";
import { createServiceClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { listCatalogServices } from "@/services/catalog-services";
import type { CatalogService } from "@/types/database";
import { formatCurrency } from "@/lib/utils";

export type CatalogRateCardPriceSide = "charge" | "pay";

export type CatalogRateCardLineKind = "hourly" | "fixed" | "preset" | "addon";

export type CatalogRateCardLine = {
  id: string;
  label: string;
  price: string;
  detail?: string;
  kind: CatalogRateCardLineKind;
};

export type CatalogRateCardServiceRow = {
  id: string;
  name: string;
  description: string | null;
  missing: boolean;
  pricingStyle: "hourly" | "fixed" | "banded";
  lines: CatalogRateCardLine[];
  presets: CatalogRateCardLine[];
  addons: CatalogRateCardLine[];
};

export type CatalogRateCardCategorySection = {
  id: CatalogServiceCategory;
  label: string;
  services: CatalogRateCardServiceRow[];
};

export type CatalogRateCardPayload = {
  generatedAt: string;
  totalActive: number;
  priceSide: CatalogRateCardPriceSide;
  categories: CatalogRateCardCategorySection[];
};

function fmt(amount: number): string {
  return formatCurrency(amount).replace(/\u00a0/g, "");
}

function lineAmount(line: PricingLineRow, side: CatalogRateCardPriceSide): number {
  return side === "charge" ? line.charge : line.pay;
}

function lineKindFromRow(line: PricingLineRow): CatalogRateCardLineKind {
  if (line.unit === "/h") return "hourly";
  if (line.isAddon) return "addon";
  return line.label === "Standard" ? "fixed" : "preset";
}

function mapPriceLine(line: PricingLineRow, side: CatalogRateCardPriceSide): CatalogRateCardLine {
  const amount = lineAmount(line, side);
  const price = line.unit === "/h" ? `${fmt(amount)}${line.unit}` : fmt(amount);
  return {
    id: line.id,
    label: line.label,
    price,
    detail: line.note || undefined,
    kind: lineKindFromRow(line),
  };
}

/** Map catalog view — charge (client sell) or pay (partner). Add-ons only for certificates. */
export function mapViewToRateCardRow(
  view: ServicePricingView,
  category: CatalogServiceCategory,
  side: CatalogRateCardPriceSide,
): CatalogRateCardServiceRow {
  const includeAddons = category === "certificates";

  if (view.missing) {
    return {
      id: view.id,
      name: view.name,
      description: view.service.default_description ?? null,
      missing: true,
      pricingStyle: "fixed",
      lines: [],
      presets: [],
      addons: [],
    };
  }

  const presets: CatalogRateCardLine[] = [];
  const addons: CatalogRateCardLine[] = [];
  const lines: CatalogRateCardLine[] = [];

  if (view.single) {
    const amount = lineAmount(view.single, side);
    if (amount <= 0) {
      return {
        id: view.id,
        name: view.name,
        description: view.service.default_description ?? null,
        missing: true,
        pricingStyle: "fixed",
        lines: [],
        presets: [],
        addons: [],
      };
    }
    const row = mapPriceLine(view.single, side);
    lines.push(row);
    const isHourly = view.single.unit === "/h";
    return {
      id: view.id,
      name: view.name,
      description: view.service.default_description ?? null,
      missing: false,
      pricingStyle: isHourly ? "hourly" : "fixed",
      lines,
      presets: [],
      addons: [],
    };
  }

  view.base.forEach((band) => {
    if (lineAmount(band, side) > 0) presets.push(mapPriceLine(band, side));
  });

  if (includeAddons) {
    view.addons.forEach((addon) => {
      if (lineAmount(addon, side) > 0) addons.push(mapPriceLine(addon, side));
    });
  }

  const hasPrices = presets.length > 0 || addons.length > 0;

  return {
    id: view.id,
    name: view.name,
    description: view.service.default_description ?? null,
    missing: !hasPrices,
    pricingStyle: "banded",
    lines: [...presets, ...addons],
    presets,
    addons,
  };
}

export function buildRateCardPayloadFromRows(
  rows: CatalogService[],
  side: CatalogRateCardPriceSide,
): CatalogRateCardPayload {
  const views = buildAllServicePricingViews(rows).filter((v) => v.isActive);
  const grouped = groupViewsByCategory(views);

  const categories: CatalogRateCardCategorySection[] = CATALOG_CATEGORY_ORDER.map((id) => ({
    id,
    label: CATALOG_CATEGORY_LABELS[id],
    services: (grouped.get(id) ?? []).map((view) =>
      mapViewToRateCardRow(view, resolveCatalogServiceCategory(view.service), side),
    ),
  })).filter((c) => c.services.length > 0);

  return {
    generatedAt: new Date().toISOString(),
    totalActive: views.length,
    priceSide: side,
    categories,
  };
}

export async function fetchActiveCatalogRows(): Promise<CatalogService[]> {
  if (typeof window === "undefined" && isServiceRoleConfigured()) {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("service_catalog")
      .select("*")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .limit(500);
    if (error) throw error;
    return (data ?? []) as CatalogService[];
  }

  const { data } = await listCatalogServices({
    page: 1,
    pageSize: 500,
    status: "active",
    sortBy: "sort_order",
    sortDir: "asc",
  });
  return data as CatalogService[];
}
