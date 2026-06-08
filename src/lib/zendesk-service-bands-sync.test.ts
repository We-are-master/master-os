import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bandIdToZendeskTag,
  planBandsZendeskSync,
  formatBandZendeskOptionName,
} from "./zendesk-service-bands-sync";

describe("bandIdToZendeskTag", () => {
  it("prefixes band_", () => {
    assert.equal(bandIdToZendeskTag("abc"), "band_abc");
  });
});

describe("planBandsZendeskSync", () => {
  it("appends new presets", () => {
    const plan = planBandsZendeskSync([], [
      { id: "p1", label: "Studio", sort_order: 0, fixed_price: 50, partner_cost: 30 },
    ]);
    assert.equal(plan.options.length, 1);
    assert.equal(plan.options[0]?.value, "band_p1");
    assert.equal(plan.stats.append, 1);
  });

  it("renames when label changes", () => {
    const plan = planBandsZendeskSync(
      [{ name: "Old", value: "band_p1" }],
      [{ id: "p1", label: "Studio", sort_order: 0, fixed_price: 50 }],
    );
    assert.equal(plan.options[0]?.name, formatBandZendeskOptionName({ label: "Studio", fixed_price: 50 }));
    assert.equal(plan.stats.rename, 1);
  });
});
