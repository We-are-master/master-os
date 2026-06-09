import {
  CATALOG_CATEGORY_LABELS,
  CATALOG_CATEGORY_ORDER,
  groupViewsByCategory,
  type CatalogServiceCategory,
} from "@/lib/catalog-service-categories";
import { resolveInitialBilledHours } from "@/lib/job-hourly-billing";
import {
  buildAllServicePricingViews,
  type ServicePricingView,
} from "@/lib/services-pricing-display";
import { listCatalogServices } from "@/services/catalog-services";
import type { CatalogService } from "@/types/database";
import { formatCurrency } from "@/lib/utils";

export type SchoolCatalogPriceItem = {
  label: string;
  price: string;
  detail?: string;
};

export type SchoolCatalogServiceRow = {
  id: string;
  name: string;
  model: string;
  missing: boolean;
  isActive: boolean;
  description: string | null;
  /** Simple single-band pricing (hourly/fixed). */
  simple: SchoolCatalogPriceItem | null;
  /** Base packages / bands (cleaning sizes, etc.). */
  baseBands: SchoolCatalogPriceItem[];
  /** Stackable add-ons — each item separate. */
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

function mapPriceItem(
  label: string,
  charge: number,
  detail?: string,
): SchoolCatalogPriceItem {
  return { label, price: fmt(charge), detail };
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
    const line = view.single;
    if (line.unit === "/h") {
      const hours = resolveInitialBilledHours(view.service.default_hours);
      const rate = Number(view.service.hourly_rate) || (hours > 0 ? line.charge / hours : line.charge);
      simple = {
        label: view.name,
        price: `${fmt(rate)}/h`,
        detail: `Default ${hours}h · ${fmt(rate * hours)} total`,
      };
    } else {
      simple = mapPriceItem(view.name, line.charge, "Fixed price");
    }
  } else if (view.stackable && view.base.length > 0) {
    for (const band of view.base) {
      if (band.unit === "/h") {
        const hours = resolveInitialBilledHours(view.service.default_hours);
        const rate = hours > 0 ? band.charge / hours : band.charge;
        baseBands.push({
          label: band.label,
          price: `${fmt(rate)}/h`,
          detail: `Default ${hours}h · ${fmt(band.charge)} total`,
        });
      } else if (band.charge > 0) {
        baseBands.push(mapPriceItem(band.label, band.charge));
      }
    }
    for (const addon of view.addons) {
      if (addon.charge > 0) {
        addons.push(mapPriceItem(addon.label, addon.charge));
      }
    }
  } else if (view.base.length > 0) {
    for (const band of view.base) {
      if (band.unit === "/h") {
        const hours = resolveInitialBilledHours(view.service.default_hours);
        const rate = hours > 0 ? band.charge / hours : band.charge;
        baseBands.push({
          label: band.label,
          price: `${fmt(rate)}/h`,
          detail: `Default ${hours}h · ${fmt(band.charge)} total`,
        });
      } else if (band.charge > 0) {
        baseBands.push(mapPriceItem(band.label, band.charge));
      }
    }
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
