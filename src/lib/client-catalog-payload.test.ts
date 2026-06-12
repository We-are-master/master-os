import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildClientCatalogPayloadFromRows,
  mapViewToClientCatalogRow,
} from "./client-catalog-payload";
import { buildServicePricingView } from "./services-pricing-display";
import type { CatalogService } from "@/types/database";

function baseService(overrides: Partial<CatalogService> = {}): CatalogService {
  return {
    id: "svc-1",
    name: "Carpenter",
    pricing_mode: "hourly",
    fixed_price: 0,
    hourly_rate: 78,
    default_hours: 1,
    partner_cost: 45,
    default_description: "Joinery and repairs",
    sort_order: 1,
    is_active: true,
    display_icon_key: null,
    pricing_presets: null,
    pricing_addons: null,
    partner_email_notes_hourly: null,
    partner_email_notes_fixed: null,
    partner_email_notes_default: null,
    accepts_smart_price: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("mapViewToClientCatalogRow", () => {
  it("exposes hourly charge only for trades — no pay or margin", () => {
    const view = buildServicePricingView(baseService());
    const row = mapViewToClientCatalogRow(view, "trades");
    assert.equal(row.pricingStyle, "hourly");
    assert.equal(row.lines.length, 1);
    assert.match(row.lines[0].price, /£78/);
    assert.equal(row.lines[0].kind, "hourly");
    assert.equal((row.lines[0] as { pay?: string }).pay, undefined);
  });

  it("hides addons for cleaning even when stackable", () => {
    const view = buildServicePricingView(
      baseService({
        name: "(DC) Domestic Clean",
        pricing_mode: "fixed",
        fixed_price: 0,
        hourly_rate: 0,
        pricing_presets: [
          {
            id: "p1",
            label: "1 bed",
            fixed_price: 120,
            partner_cost: 70,
            sort_order: 1,
          },
        ],
        pricing_addons: [
          { id: "a1", label: "Oven deep clean", fixed_price: 35, partner_cost: 20, sort_order: 1 },
        ],
      }),
    );
    const row = mapViewToClientCatalogRow(view, "cleaning");
    assert.equal(row.presets.length, 1);
    assert.equal(row.addons.length, 0);
    assert.equal(row.lines.length, 1);
  });

  it("shows presets and addons for certificates", () => {
    const view = buildServicePricingView(
      baseService({
        name: "(EPC) Energy Performance Certificate",
        pricing_mode: "fixed",
        fixed_price: 0,
        pricing_presets: [
          { id: "p1", label: "Flat", fixed_price: 85, partner_cost: 50, sort_order: 1 },
          { id: "p2", label: "House", fixed_price: 110, partner_cost: 65, sort_order: 2 },
        ],
        pricing_addons: [
          { id: "a1", label: "Urgent turnaround", fixed_price: 25, partner_cost: 10, sort_order: 1 },
        ],
      }),
    );
    const row = mapViewToClientCatalogRow(view, "certificates");
    assert.equal(row.presets.length, 2);
    assert.equal(row.addons.length, 1);
    assert.equal(row.lines.length, 3);
  });
});

describe("buildClientCatalogPayloadFromRows", () => {
  it("groups active services by category", () => {
    const payload = buildClientCatalogPayloadFromRows([
      baseService({ id: "t1", name: "Electrician", hourly_rate: 72 }),
      baseService({
        id: "c1",
        name: "(GSC) Gas Safety Certificate",
        pricing_mode: "fixed",
        fixed_price: 95,
        hourly_rate: 0,
        is_active: true,
      }),
      baseService({ id: "x1", name: "Inactive", is_active: false }),
    ]);
    assert.equal(payload.totalActive, 2);
    assert.ok(payload.categories.some((c) => c.id === "trades"));
    assert.ok(payload.categories.some((c) => c.id === "certificates"));
  });
});
