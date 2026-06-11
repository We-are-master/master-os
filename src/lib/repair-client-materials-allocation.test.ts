import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clientMaterialsMisallocationPatch } from "./repair-client-materials-allocation";

describe("clientMaterialsMisallocationPatch", () => {
  it("repairs JOB-9278-style misallocation (33.70 client + 28.08 partner in materials_cost)", () => {
    const patch = clientMaterialsMisallocationPatch(
      {
        client_price: 91,
        extras_amount: 0,
        materials_cost: 61.78,
        partner_cost: 54.6,
        customer_deposit: 0,
      },
      [
        { side: "client", extra_type: "MATERIALS", amount: 33.7, allocation: "materials" },
        { side: "partner", extra_type: "MATERIALS", amount: 28.08, allocation: "materials" },
      ],
    );
    assert.ok(patch);
    assert.equal(patch!.extras_amount, 33.7);
    assert.equal(patch!.materials_cost, 28.08);
    assert.equal(patch!.customer_final_payment, 124.7);
  });

  it("is idempotent once materials_cost matches partner ledger", () => {
    const patch = clientMaterialsMisallocationPatch(
      {
        client_price: 91,
        extras_amount: 33.7,
        materials_cost: 28.08,
        partner_cost: 54.6,
        customer_deposit: 0,
      },
      [
        { side: "client", extra_type: "MATERIALS", amount: 33.7, allocation: "materials" },
        { side: "partner", extra_type: "MATERIALS", amount: 28.08, allocation: "materials" },
      ],
    );
    assert.equal(patch, null);
  });
});
