import {
  CATALOG_CATEGORY_LABELS,
  CATALOG_CATEGORY_ORDER,
  groupViewsByCategory,
  type CatalogServiceCategory,
} from "@/lib/catalog-service-categories";
import {
  buildAllServicePricingViews,
  type PricingLineRow,
  type ServicePricingView,
} from "@/lib/services-pricing-display";
import { listCatalogServices } from "@/services/catalog-services";
import type { CatalogService } from "@/types/database";
import { formatCurrency } from "@/lib/utils";

export type SchoolCatalogPriceItem = {
  label: string;
  price: string;
  detail?: string;
  pay?: string;
  charge?: string;
  payAmount?: number;
  chargeAmount?: number;
  marginPct?: number;
  marginTier?: "good" | "thin" | "bad";
};

export type SchoolCatalogServiceRow = {
  id: string;
  name: string;
  model: string;
  missing: boolean;
  isActive: boolean;
  description: string | null;
  simple: SchoolCatalogPriceItem | null;
  baseBands: SchoolCatalogPriceItem[];
  addons: SchoolCatalogPriceItem[];
};

export type SchoolCatalogCategorySection = {
  id: CatalogServiceCategory;
  label: string;
  services: SchoolCatalogServiceRow[];
};

export type SchoolServiceCatalogPayload = {
  generatedAt: string;
  totalActive: number;
  categories: SchoolCatalogCategorySection[];
};

function fmt(amount: number): string {
  return formatCurrency(amount).replace(/\u00a0/g, "");
}

function mapLineRow(line: PricingLineRow): SchoolCatalogPriceItem {
  const chargeAmount = line.charge;
  const payAmount = line.pay;
  const price = line.unit === "/h" ? `${fmt(chargeAmount)}${line.unit}` : fmt(chargeAmount);
  return {
    label: line.label,
    price,
    detail: line.note || line.sub,
    pay: payAmount > 0 ? fmt(payAmount) : undefined,
    charge: price,
    payAmount: payAmount > 0 ? payAmount : undefined,
    chargeAmount: chargeAmount > 0 ? chargeAmount : undefined,
    marginPct: Math.round(line.marginPct),
    marginTier: line.tier,
  };
}

function mapView(view: ServicePricingView): SchoolCatalogServiceRow {
  if (view.missing) {
    return {
      id: view.id,
      name: view.name,
      model: view.model,
      missing: true,
      isActive: view.isActive,
      description: view.service.default_description ?? null,
      simple: null,
      baseBands: [],
      addons: [],
    };
  }

  let simple: SchoolCatalogPriceItem | null = null;
  const baseBands: SchoolCatalogPriceItem[] = [];
  const addons: SchoolCatalogPriceItem[] = [];

  if (view.single) {
    simple = mapLineRow(view.single);
  } else if (view.stackable && view.base.length > 0) {
    view.base.forEach((band) => {
      if (band.charge > 0) baseBands.push(mapLineRow(band));
    });
    view.addons.forEach((addon) => {
      if (addon.charge > 0) addons.push(mapLineRow(addon));
    });
  } else if (view.base.length > 0) {
    view.base.forEach((band) => {
      if (band.charge > 0) baseBands.push(mapLineRow(band));
    });
  }

  return {
    id: view.id,
    name: view.name,
    model: view.model,
    missing: false,
    isActive: view.isActive,
    description: view.service.default_description ?? null,
    simple,
    baseBands,
    addons,
  };
}

/** Active catalog rows grouped by category — same structure as Services → Overview. */
export async function buildSchoolServiceCatalogPayload(): Promise<SchoolServiceCatalogPayload> {
  const { data } = await listCatalogServices({
    page: 1,
    pageSize: 500,
    status: "active",
    sortBy: "sort_order",
    sortDir: "asc",
  });

  const views = buildAllServicePricingViews(data as CatalogService[]).filter((v) => v.isActive);
  const grouped = groupViewsByCategory(views);

  const categories: SchoolCatalogCategorySection[] = CATALOG_CATEGORY_ORDER.map((id) => ({
    id,
    label: CATALOG_CATEGORY_LABELS[id],
    services: (grouped.get(id) ?? []).map(mapView),
  })).filter((c) => c.services.length > 0);

  return {
    generatedAt: new Date().toISOString(),
    totalActive: views.length,
    categories,
  };
}
