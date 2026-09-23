import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogService } from "@/types/database";
import { buildServicePricingView } from "./services-pricing-display";

const band = (id: string, fixed_price: number, sort_order: number) => ({
  id,
  label: id,
  sort_order,
  fixed_price,
  partner_cost: 50,
  pricing_mode: "fixed",
});
const addon = (id: string) => ({ id, label: id, sort_order: 1, fixed_price: 130, partner_cost: 100 });

function service(presets: unknown[], addons: unknown[]): CatalogService {
  return {
    id: "s1",
    name: "Painter",
    pricing_mode: "fixed",
    fixed_price: 0,
    hourly_rate: 0,
    partner_cost: 0,
    pricing_presets: presets,
    pricing_addons: addons,
    is_active: true,
  } as unknown as CatalogService;
}

describe("buildServicePricingView subline", () => {
  it("counts the options when there are several with add-ons", () => {
    const view = buildServicePricingView(
      service([band("Touch-ups", 215, 10), band("A room", 450, 20), band("Full day", 465, 30)], [addon("Materials")]),
    );
    assert.equal(view.subline, "3 options · 1 add-on");
  });

  it("keeps Base price for a single option with add-ons", () => {
    const view = buildServicePricingView(service([band("Visit", 99, 10)], [addon("A"), addon("B")]));
    assert.equal(view.subline, "Base price · 2 add-ons");
  });

  it("keeps Pricing bands when there are no add-ons", () => {
    const view = buildServicePricingView(service([band("Studio", 129, 10), band("1 bed", 129, 20)], []));
    assert.equal(view.subline, "Pricing bands (2)");
  });
});
