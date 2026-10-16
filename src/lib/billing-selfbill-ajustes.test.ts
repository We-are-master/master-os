import { test } from "node:test";
import assert from "node:assert/strict";
import { ajustesDoDocumento } from "./billing-selfbill-actions";

test("sem ajuste, nada muda", () => {
  assert.equal(ajustesDoDocumento({ id: "x", payout_breakdown: null }), 0);
  assert.equal(ajustesDoDocumento({ id: "x", payout_breakdown: { other: 1 } }), 0);
});

test("taxa desconta e acerto a favor soma (WHistyle, 16/10/2026)", () => {
  assert.equal(ajustesDoDocumento({ id: "x", payout_breakdown: { adjustments: [{ label: "Fee JOB-9595", amount: 50 }] } }), 50);
  assert.equal(ajustesDoDocumento({ id: "x", payout_breakdown: { adjustments: [{ label: "Extras JOB-9477", amount: -56.25 }] } }), -56.25);
  assert.equal(ajustesDoDocumento({ id: "x", payout_breakdown: { adjustments: [{ label: "", amount: 10 }, { label: "Zero", amount: 0 }] } }), 0);
});
