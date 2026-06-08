import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  autoMarginFromPct,
  normalizeBandId,
  normalizeWebhookRateType,
  resolveSmartPriceRates,
  validateServiceBand,
  resolveWebhookFixedPricing,
} from "./zendesk-webhook-pricing";
import { resolvePartnerHourlyForJob } from "./job-pricing-resolver";
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

describe("normalizeWebhookRateType", () => {
  it("maps smart_price alias to hourly", () => {
    assert.equal(normalizeWebhookRateType("job_type_smart_price"), "hourly");
    assert.equal(normalizeWebhookRateType("smart_price"), "hourly");
  });
  it("maps fixed tags", () => {
    assert.equal(normalizeWebhookRateType("job_type_fixed"), "fixed");
    assert.equal(normalizeWebhookRateType("fixed"), "fixed");
  });
});

describe("resolveSmartPriceRates", () => {
  const catalog = {
    name: "Plumbing",
    pricing_presets: null,
    fixed_price: 0,
    hourly_rate: 80,
    default_hours: 2,
    pricing_mode: "hourly" as const,
    partner_cost: 100,
    sort_order: 0,
    is_active: true,
    id: "cat-1",
    created_at: "",
    updated_at: "",
  };

  it("uses partner rate card when override provided", () => {
    const r = resolveSmartPriceRates({
      hourlyClientRateFromBody: 0,
      hourlyClientRateSent: false,
      hourlyPartnerRateFromBody: 0,
      hourlyPartnerRateSent: false,
      catalog,
      accountOverride: null,
      partnerOverride: {
        id: "p1",
        partner_id: "partner-a",
        catalog_service_id: "cat-1",
        use_standard: false,
        hourly_partner_rate: 45,
        fixed_partner_cost: null,
        default_hours: null,
        created_at: "",
        updated_at: "",
        deleted_at: null,
      },
      setupMarginPct: 40,
    });
    assert.equal(r.hourlyClientRate, 80);
    assert.equal(r.hourlyPartnerRate, 45);
  });

  it("falls back to catalog ceiling without partner override", () => {
    const r = resolveSmartPriceRates({
      hourlyClientRateFromBody: 0,
      hourlyClientRateSent: false,
      hourlyPartnerRateFromBody: 0,
      hourlyPartnerRateSent: false,
      catalog,
      accountOverride: null,
      setupMarginPct: 40,
    });
    assert.equal(r.hourlyPartnerRate, 50);
  });
});

describe("resolvePartnerHourlyForJob", () => {
  const catalog = {
    pricing_mode: "hourly" as const,
    partner_cost: 100,
    default_hours: 2,
  };

  it("returns custom partner rate below ceiling", () => {
    const r = resolvePartnerHourlyForJob({
      catalog,
      partnerOverride: {
        id: "x",
        partner_id: "p",
        catalog_service_id: "c",
        use_standard: false,
        hourly_partner_rate: 42,
        fixed_partner_cost: null,
        default_hours: null,
        created_at: "",
        updated_at: "",
        deleted_at: null,
      },
    });
    assert.equal(r.value, 42);
    assert.equal(r.source, "custom");
  });

  it("returns catalog standard when use_standard", () => {
    const r = resolvePartnerHourlyForJob({
      catalog,
      partnerOverride: {
        id: "x",
        partner_id: "p",
        catalog_service_id: "c",
        use_standard: true,
        hourly_partner_rate: 30,
        fixed_partner_cost: null,
        default_hours: null,
        created_at: "",
        updated_at: "",
        deleted_at: null,
      },
    });
    assert.equal(r.value, 50);
    assert.equal(r.source, "standard");
  });
});

describe("autoMarginFromPct", () => {
  it("applies Setup margin to client sell", () => {
    assert.equal(autoMarginFromPct(100, 40), 60);
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
