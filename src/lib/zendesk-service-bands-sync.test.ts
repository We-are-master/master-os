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

const PRESET_ID = "e34ca32e-12e3-44b2-af6a-4ae4322dff57";

describe("planBandsZendeskSync", () => {
  it("appends new presets", () => {
    const plan = planBandsZendeskSync([], [
      { id: PRESET_ID, label: "Studio", sort_order: 0, fixed_price: 50, partner_cost: 30 },
    ]);
    assert.equal(plan.options.length, 1);
    assert.equal(plan.options[0]?.value, `band_${PRESET_ID}`);
    assert.equal(plan.stats.append, 1);
  });

  it("renames when label changes", () => {
    const plan = planBandsZendeskSync(
      [{ name: "Old", value: `band_${PRESET_ID}` }],
      [{ id: PRESET_ID, label: "Studio", sort_order: 0, fixed_price: 50 }],
    );
    assert.equal(plan.options[0]?.name, formatBandZendeskOptionName({ label: "Studio", fixed_price: 50 }));
    assert.equal(plan.stats.rename, 1);
  });
});
