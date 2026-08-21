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

  /** Formato novo da migração 272: sem ano, cinco dígitos. */
  it("keeps the sequence-only reference intact", () => {
    assert.equal(billingReferenceShort("RCP-63356"), "63356");
    assert.equal(displayBillingReference("RCP-63356"), "RCP-63356");
  });

  /** Uma fatura antiga e uma nova convivem, e nenhuma vira a outra. */
  it("does not confuse the two formats", () => {
    assert.equal(displayBillingReference("INV-2026-357"), "RCP-2026-357");
    assert.equal(displayBillingReference("RCP-63356"), "RCP-63356");
    assert.notEqual(displayBillingReference("RCP-63356"), displayBillingReference("RCP-2026-357"));
  });
});
