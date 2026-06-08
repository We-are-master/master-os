import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPayDelta,
  buildSellDelta,
  catalogPartnerHourlyRate,
  isAccountSellValid,
  isPartnerPayValid,
  marginPercent,
  resolveAccountSell,
  resolvePartnerPay,
} from "./catalog-pricing-floor-ceiling";

describe("resolveAccountSell", () => {
  it("returns floor when no override", () => {
    assert.equal(resolveAccountSell(74.35, null), 74.35);
  });
  it("returns higher override", () => {
    assert.equal(resolveAccountSell(74.35, 80), 80);
  });
  it("clamps below floor to floor", () => {
    assert.equal(resolveAccountSell(74.35, 70), 74.35);
  });
});

describe("resolvePartnerPay", () => {
  it("returns ceiling when no override", () => {
    assert.equal(resolvePartnerPay(45, null), 45);
  });
  it("returns lower override", () => {
    assert.equal(resolvePartnerPay(45, 40), 40);
  });
  it("clamps above ceiling to ceiling", () => {
    assert.equal(resolvePartnerPay(45, 50), 45);
  });
});

describe("delta labels", () => {
  it("sell above minimum", () => {
    const d = buildSellDelta(74.35, 80);
    assert.equal(d.valid, true);
    assert.equal(d.label, "+£5.65 above minimum");
  });
  it("pay below ceiling", () => {
    const d = buildPayDelta(45, 40);
    assert.equal(d.valid, true);
    assert.equal(d.label, "−£5.00 below ceiling");
  });
  it("invalid sell below floor", () => {
    assert.equal(isAccountSellValid(74.35, 70), false);
  });
  it("invalid pay above ceiling", () => {
    assert.equal(isPartnerPayValid(45, 50), false);
  });
});

describe("marginPercent", () => {
  it("computes margin", () => {
    assert.equal(marginPercent(100, 60), 40);
  });
});

describe("catalogPartnerHourlyRate", () => {
  it("divides partner_cost by hours", () => {
    assert.equal(catalogPartnerHourlyRate(170, 2), 85);
  });
});
