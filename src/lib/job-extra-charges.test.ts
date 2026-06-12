import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Job } from "@/types/database";
import {
  applyCustomerExtraPatch,
  applyPartnerExtraPatch,
  reverseCustomerExtraPatch,
} from "./job-extra-charges";
import { jobBillableRevenue, jobProfit, partnerPaymentCap, partnerSelfBillGrossAmount } from "./job-financials";

function baseJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    reference: "JOB-9278",
    client_price: 91,
    extras_amount: 0,
    materials_cost: 0,
    partner_cost: 54.6,
    customer_deposit: 0,
    customer_final_payment: 91,
    margin_percent: 0,
    service_value: 91,
    ...overrides,
  } as Job;
}

describe("applyCustomerExtraPatch", () => {
  it("client materials extra increases extras_amount, not materials_cost", () => {
    const job = baseJob();
    const patch = applyCustomerExtraPatch(job, 33.7, "materials");
    assert.equal(patch.extras_amount, 33.7);
    assert.equal(patch.materials_cost, 0);
    assert.equal(patch.customer_final_payment, 124.7);
  });

  it("reverse client materials extra reduces extras_amount", () => {
    const job = baseJob({ extras_amount: 33.7, customer_final_payment: 124.7, service_value: 124.7 });
    const patch = reverseCustomerExtraPatch(job, 33.7, "materials");
    assert.equal(patch.extras_amount, 0);
    assert.equal(patch.materials_cost, 0);
    assert.equal(patch.customer_final_payment, 91);
  });
});

describe("applyPartnerExtraPatch", () => {
  it("partner materials extra increases materials_cost only", () => {
    const job = baseJob();
    const patch = applyPartnerExtraPatch(job, 28.08, "materials");
    assert.equal(patch.materials_cost, 28.08);
    assert.equal(patch.extras_amount, undefined);
  });
});

describe("JOB-9278 combined scenario", () => {
  it("client £33.70 + partner £28.08 yields positive margin", () => {
    let job = baseJob();
    job = { ...job, ...applyCustomerExtraPatch(job, 33.7, "materials") };
    job = { ...job, ...applyPartnerExtraPatch(job, 28.08, "materials") };

    const billable = jobBillableRevenue(job);
    const profit = jobProfit(job);
    const partnerCashOut = partnerSelfBillGrossAmount(job);

    assert.equal(billable, 124.7);
    assert.equal(Number(job.materials_cost), 28.08);
    assert.equal(partnerPaymentCap(job), 54.6);
    assert.equal(partnerCashOut, 82.68);
    assert.ok(profit > 0);
    assert.ok(Math.abs(profit - 42.02) < 0.01);
  });
});
