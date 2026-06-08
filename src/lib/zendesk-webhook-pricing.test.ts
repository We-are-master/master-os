import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBandId,
  validateServiceBand,
  resolveWebhookFixedPricing,
} from "./zendesk-webhook-pricing";
import type { CatalogService } from "@/types/database";

const svcWithBands: Pick<CatalogService, "name" | "pricing_presets"> = {
  name: "EPC",
  pricing_presets: [
    { id: "b1", label: "3 Bed House", sort_order: 0, fixed_price: 74.35, partner_cost: 44.61 },
  ],
};

describe("normalizeBandId", () => {
  it("strips band_ prefix from uuid", () => {
    assert.equal(
      normalizeBandId("band_d46d6534-90b7-41c8-89ea-5d4ae1e296c9"),
      "d46d6534-90b7-41c8-89ea-5d4ae1e296c9",
    );
  });
  it("accepts raw uuid", () => {
    assert.equal(
      normalizeBandId("d46d6534-90b7-41c8-89ea-5d4ae1e296c9"),
      "d46d6534-90b7-41c8-89ea-5d4ae1e296c9",
    );
  });
});

describe("validateServiceBand", () => {
  it("requires band when presets exist", () => {
    const r = validateServiceBand(svcWithBands, null);
    assert.equal(r.ok, false);
  });
  it("accepts valid band", () => {
    const r = validateServiceBand(svcWithBands, "b1");
    assert.equal(r.ok, true);
    if (r.ok && r.hasBands) assert.equal(r.band?.label, "3 Bed House");
  });
});

describe("resolveWebhookFixedPricing", () => {
  it("uses band pricing when no body override", () => {
    const catalog = {
      name: "EPC",
      pricing_presets: svcWithBands.pricing_presets,
      fixed_price: 0,
      hourly_rate: 0,
      default_hours: 2,
      pricing_mode: "fixed" as const,
      partner_cost: 0,
      sort_order: 0,
      is_active: true,
      id: "x",
      created_at: "",
      updated_at: "",
    };
    const band = svcWithBands.pricing_presets![0];
    const r = resolveWebhookFixedPricing({
      clientPriceFromBody: 0,
      clientPriceSent: false,
      partnerCostFromBody: 0,
      partnerCostSent: false,
      catalog,
      band,
      accountOverride: null,
    });
    assert.equal(r.clientPrice, 74.35);
    assert.equal(r.partnerCost, 44.61);
    assert.equal(r.bandLabel, "3 Bed House");
  });
});
