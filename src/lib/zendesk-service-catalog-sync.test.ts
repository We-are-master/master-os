import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planCatalogBackfill } from "./zendesk-service-catalog-sync";

const EICR_ID = "e0cbd852-c10c-4aac-b52c-dfd274b65848";

describe("planCatalogBackfill", () => {
  it("rewrites legacy bare UUID to os_ prefix", () => {
    const plan = planCatalogBackfill(
      [{ id: 1, name: "EICR", value: EICR_ID }],
      [{ id: EICR_ID, name: "(EICR) Electrical Installation Condition Report" }],
    );
    assert.equal(plan.options[0]?.value, `os_${EICR_ID}`);
    assert.equal(plan.stats.rewrite, 1);
  });

  it("leaves os_ prefixed options unchanged when name matches", () => {
    const name = "(EICR) Electrical Installation Condition Report";
    const plan = planCatalogBackfill(
      [{ id: 1, name, value: `os_${EICR_ID}` }],
      [{ id: EICR_ID, name }],
    );
    assert.equal(plan.stats.unchanged, 1);
    assert.equal(plan.options[0]?.value, `os_${EICR_ID}`);
  });

  it("appends missing services with os_ tag", () => {
    const id = "f31ba2ac-fd22-4961-9081-98e64e4b5c95";
    const plan = planCatalogBackfill([], [{ id, name: "General Maintenance" }]);
    assert.equal(plan.options[0]?.value, `os_${id}`);
    assert.equal(plan.stats.append, 1);
  });
});
