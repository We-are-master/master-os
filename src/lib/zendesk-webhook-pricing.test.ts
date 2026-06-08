import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  autoMarginFromPct,
  catalogDefaultHoursForBilling,
  inferWebhookRateTypeFromCatalog,
  normalizeBandId,
  normalizeWebhookRateType,
  resolveFixedManualPricing,
  resolveSmartPriceRates,
  resolveWebhookAutoAssignStatus,
  validateServiceBand,
} from "./zendesk-webhook-pricing";
import { resolveInitialBilledHours } from "./job-hourly-billing";
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
  it("returns null for empty rate_type from Zendesk", () => {
    assert.equal(normalizeWebhookRateType(""), null);
    assert.equal(normalizeWebhookRateType("   "), null);
  });
});

describe("inferWebhookRateTypeFromCatalog", () => {
  it("infers hourly for Gardener-style smart-price catalog", () => {
    assert.equal(
      inferWebhookRateTypeFromCatalog({ pricing_mode: "hourly", accepts_smart_price: true }),
      "hourly",
    );
  });
  it("infers hourly when only pricing_mode is hourly", () => {
    assert.equal(
      inferWebhookRateTypeFromCatalog({ pricing_mode: "hourly", accepts_smart_price: false }),
      "hourly",
    );
  });
  it("returns null for fixed-only catalog", () => {
    assert.equal(
      inferWebhookRateTypeFromCatalog({ pricing_mode: "fixed", accepts_smart_price: false }),
      null,
    );
  });
});

describe("resolveWebhookAutoAssignStatus", () => {
  it("auto_assign with zero matches → unassigned", () => {
    assert.equal(resolveWebhookAutoAssignStatus(true, []), "unassigned");
  });
  it("auto_assign with partners → auto_assigning", () => {
    assert.equal(resolveWebhookAutoAssignStatus(true, ["p1"]), "auto_assigning");
  });
  it("no auto_assign → unassigned", () => {
    assert.equal(resolveWebhookAutoAssignStatus(false, ["p1"]), "unassigned");
  });
});

describe("catalogDefaultHoursForBilling", () => {
  const catalog = { default_hours: 2 };

  it("prefers band default_hours over catalog", () => {
    assert.equal(
      catalogDefaultHoursForBilling(catalog, { default_hours: 3 } as never),
      3,
    );
  });

  it("Gardener hourly webhook billed_hours floor is at least 2h", () => {
    const gardenerCatalog = { default_hours: 1 };
    const hours = resolveInitialBilledHours(
      catalogDefaultHoursForBilling(gardenerCatalog, null),
    );
    assert.ok(hours >= 2);
  });

  it("band with sub-2 default still floors to 2h billed", () => {
    const hours = resolveInitialBilledHours(
      catalogDefaultHoursForBilling(catalog, { default_hours: 0.5 } as never),
    );
    assert.equal(hours, 2);
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

  it("uses band pricing with account rate card for Smart Pricing", () => {
    const bandCatalog = {
      ...catalog,
      name: "EPC",
      pricing_presets: svcWithBands.pricing_presets,
      hourly_rate: 0,
      fixed_price: 0,
      default_hours: 2,
    };
    const band = svcWithBands.pricing_presets![0];
    const r = resolveSmartPriceRates({
      hourlyClientRateFromBody: 0,
      hourlyClientRateSent: false,
      hourlyPartnerRateFromBody: 0,
      hourlyPartnerRateSent: false,
      catalog: bandCatalog,
      accountOverride: null,
      band,
      setupMarginPct: 40,
    });
    assert.equal(r.hourlyClientRate, 37.175);
    assert.equal(r.hourlyPartnerRate, 22.305);
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
        use_standard: false,
        hourly_partner_rate: 42,
        fixed_partner_cost: null,
        preset_overrides: {},
      },
    });
    assert.equal(r.value, 42);
    assert.equal(r.source, "custom");
  });

  it("returns catalog standard when use_standard", () => {
    const r = resolvePartnerHourlyForJob({
      catalog,
      partnerOverride: {
        use_standard: true,
        hourly_partner_rate: 30,
        fixed_partner_cost: null,
        preset_overrides: {},
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

describe("resolveFixedManualPricing", () => {
  it("applies Setup margin to manual client price", () => {
    const r = resolveFixedManualPricing({
      clientPrice: 100,
      partnerCostSent: false,
      partnerCost: 0,
      targetMarginPct: 40,
    });
    assert.equal(r.clientPrice, 100);
    assert.equal(r.partnerCost, 60);
  });

  it("keeps explicit partner_cost when sent", () => {
    const r = resolveFixedManualPricing({
      clientPrice: 100,
      partnerCostSent: true,
      partnerCost: 55,
      targetMarginPct: 40,
    });
    assert.equal(r.partnerCost, 55);
  });
});
