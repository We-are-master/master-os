import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  invoiceAmountDueForRequest,
  invoiceRequestBaseAmount,
} from "./invoice-request-amount";

describe("invoiceRequestBaseAmount", () => {
  it("uses balance when partially paid", () => {
    assert.equal(invoiceRequestBaseAmount({ amount: 334, amount_paid: 100 }), 234);
  });

  it("uses full amount when nothing paid", () => {
    assert.equal(invoiceRequestBaseAmount({ amount: 334, amount_paid: 0 }), 334);
  });
});

describe("invoiceAmountDueForRequest", () => {
  it("computes 50% of total", () => {
    const r = invoiceAmountDueForRequest({ amount: 334, amount_paid: 0 }, 50);
    assert.equal(r.percent, 50);
    assert.equal(r.amountDueNow, 167);
  });

  it("computes 50% of balance when partial", () => {
    const r = invoiceAmountDueForRequest({ amount: 334, amount_paid: 134 }, 50);
    assert.equal(r.baseAmount, 200);
    assert.equal(r.amountDueNow, 100);
  });
});
