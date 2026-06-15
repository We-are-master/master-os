import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitInvoiceTradeAndFee } from "./invoice-trade-fee-split";

describe("splitInvoiceTradeAndFee", () => {
  it("splits full invoice using job margin (client − partner − materials)", () => {
    const job = {
      client_price: 8280,
      extras_amount: 0,
      commission: 0,
      partner_cost: 6000,
      materials_cost: 200,
      partner_agreed_value: 8280,
    };
    const { trade, fee } = splitInvoiceTradeAndFee(8280, job);
    assert.equal(trade, 6200);
    assert.equal(fee, 2080);
  });

  it("uses stored job commission when set", () => {
    const job = {
      client_price: 1000,
      extras_amount: 0,
      commission: 250,
      partner_cost: 600,
      materials_cost: 0,
      partner_agreed_value: 750,
    };
    const { trade, fee } = splitInvoiceTradeAndFee(1000, job);
    assert.equal(fee, 250);
    assert.equal(trade, 750);
  });

  it("scales deposit invoices proportionally", () => {
    const job = {
      client_price: 1000,
      extras_amount: 0,
      commission: 0,
      partner_cost: 600,
      materials_cost: 0,
      partner_agreed_value: 0,
    };
    const { trade, fee } = splitInvoiceTradeAndFee(300, job);
    assert.equal(trade, 180);
    assert.equal(fee, 120);
  });

  it("uses default platform fee % when job margin is zero", () => {
    const job = {
      client_price: 1000,
      extras_amount: 0,
      commission: 0,
      partner_cost: 1000,
      materials_cost: 0,
      partner_agreed_value: 1000,
    };
    const { trade, fee } = splitInvoiceTradeAndFee(1000, job, { defaultPlatformFeePct: 25 });
    assert.equal(fee, 250);
    assert.equal(trade, 750);
  });
});
