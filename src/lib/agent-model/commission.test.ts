import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { platformBookingCommission, vatFromInclusive } from "./commission";
import {
  buildCommissionInvoiceLines,
  commissionFlagWarnings,
  commissionInvoiceTotals,
  type SelfBillAgentSummary,
} from "./commission-invoice";

describe("platformBookingCommission", () => {
  it("commission = client price + extras minus partner net (Commission Schedule: 2 bed EoT)", () => {
    const c = platformBookingCommission({ clientPrice: 266, extrasAmount: 0, partnerCost: 166, materialsCost: 0 });
    assert.deepEqual(c, { customerPrice: 266, partnerNet: 166, commission: 100, flagged: false, shortfall: 0 });
  });

  it("extras and materials count on their side", () => {
    const c = platformBookingCommission({ clientPrice: 266, extrasAmount: 76, partnerCost: 166, materialsCost: 46 });
    assert.equal(c.customerPrice, 342);
    assert.equal(c.partnerNet, 212);
    assert.equal(c.commission, 130);
  });

  it("never negative: clamps to 0 and flags", () => {
    const c = platformBookingCommission({ clientPrice: 100, partnerCost: 120 });
    assert.equal(c.commission, 0);
    assert.equal(c.flagged, true);
    assert.equal(c.shortfall, 20);
  });
});

describe("vatFromInclusive", () => {
  it("20%: VAT is total/6, net is the rest", () => {
    assert.deepEqual(vatFromInclusive(247), { gross: 247, vat: 41.17, net: 205.83, ratePct: 20 });
    assert.deepEqual(vatFromInclusive(100), { gross: 100, vat: 16.67, net: 83.33, ratePct: 20 });
  });
});

describe("commission VAT invoice lines", () => {
  const summary: SelfBillAgentSummary = {
    platformLines: [
      { reference: "JOB-1", doneOn: "2026-10-01", title: "EoT", customerPrice: 266, commission: 100, partnerNet: 166, flagged: false, shortfall: 0 },
      { reference: "JOB-2", title: "Odd", customerPrice: 100, commission: 0, partnerNet: 120, flagged: true, shortfall: 20 },
    ],
    lateWithdrawalFees: [{ reference: "JOB-3", amount: 50 }],
    hasPlatformBookings: true,
    hasClientWork: false,
  };

  it("one line per commission above zero plus each Late-Withdrawal Fee", () => {
    const lines = buildCommissionInvoiceLines(summary);
    assert.deepEqual(lines.map((l) => [l.kind, l.reference, l.amount]), [
      ["commission", "JOB-1", 100],
      ["late_withdrawal_fee", "JOB-3", 50],
    ]);
    assert.deepEqual(commissionInvoiceTotals(lines), { totalIncVat: 150, vatAmount: 25, netAmount: 125, vatRatePct: 20 });
  });

  it("no summary (model off) means no invoice", () => {
    assert.deepEqual(buildCommissionInvoiceLines(null), []);
  });

  it("flags lines where the partner gets more than the customer paid", () => {
    const w = commissionFlagWarnings(summary);
    assert.equal(w.length, 1);
    assert.match(w[0], /JOB-2/);
  });
});
