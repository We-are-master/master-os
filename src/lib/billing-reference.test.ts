import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { billingReferenceCandidates, billingReferenceShort, displayBillingReference } from "./billing-reference";

describe("billing-reference", () => {
  it("shows stored RCP rows as INV", () => {
    assert.equal(displayBillingReference("RCP-2026-904"), "INV-2026-904");
    assert.equal(displayBillingReference("RC-2026-12"), "INV-2026-12");
  });

  it("keeps INV and strips short form", () => {
    assert.equal(billingReferenceShort("INV-2026-357"), "2026-357");
    assert.equal(displayBillingReference("INV-2026-357"), "INV-2026-357");
  });

  it("handles the sequence format without a year", () => {
    assert.equal(billingReferenceShort("RCP-63356"), "63356");
    assert.equal(displayBillingReference("RCP-63356"), "INV-63356");
  });

  it("different invoices never collapse into the same display reference", () => {
    assert.notEqual(displayBillingReference("RCP-63356"), displayBillingReference("RCP-2026-357"));
  });

  it("finds the same invoice by the old and the new prefix", () => {
    assert.deepEqual(billingReferenceCandidates("INV-2026-915"), ["INV-2026-915", "RCP-2026-915", "RC-2026-915"]);
    assert.deepEqual(billingReferenceCandidates("RCP-2026-915"), ["RCP-2026-915", "INV-2026-915", "RC-2026-915"]);
    assert.ok(billingReferenceCandidates(" rcp-2026-915 ").includes("RCP-2026-915"));
    assert.deepEqual(billingReferenceCandidates(""), []);
  });
});
