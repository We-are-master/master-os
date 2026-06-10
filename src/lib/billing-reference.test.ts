import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { billingReferenceShort, displayBillingReference } from "@/lib/billing-reference";

describe("billing-reference", () => {
  it("maps legacy INV to RCP display", () => {
    assert.equal(displayBillingReference("INV-2026-357"), "RCP-2026-357");
  });

  it("keeps RCP and strips short form", () => {
    assert.equal(billingReferenceShort("RCP-2026-400"), "2026-400");
    assert.equal(displayBillingReference("RCP-2026-400"), "RCP-2026-400");
  });
});
