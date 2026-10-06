import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { customerBalanceCap, loadJobPromotionAmount } from "./promotion";
import {
  canMarkJobCompletedFinancially,
  customerCollectionsSatisfyBillable,
  jobBillableRevenue,
  jobCustomerTotal,
} from "@/lib/job-financials";
import { applyCustomerExtraPatch } from "@/lib/job-extra-charges";
import type { Job } from "@/types/database";

describe("customer never pays the Fixfy promotion", () => {
  const job = { client_price: 266, extras_amount: 76, promotion_amount: 34.2 } as Job;

  it("customer total = price + extras - promotion; revenue stays the full price", () => {
    assert.equal(jobCustomerTotal(job), 307.8);
    assert.equal(jobBillableRevenue(job), 342);
    assert.equal(jobCustomerTotal({ client_price: 100, extras_amount: 0 } as Job), 100);
    assert.equal(jobCustomerTotal({ client_price: 10, promotion_amount: 50 } as Job), 0);
  });

  it("pay link cap = customer total - already paid", () => {
    assert.equal(customerBalanceCap({ clientPrice: 266, extrasAmount: 76, promotionAmount: 34.2, amountPaid: 153.9 }), 153.9);
    assert.equal(customerBalanceCap({ clientPrice: 266, promotionAmount: 26.6, amountPaid: 300 }), 0);
  });

  it("financial close is satisfied by the net amount", () => {
    const full = { ...job, partner_cost: 0, partner_agreed_value: 0 } as Job;
    assert.equal(customerCollectionsSatisfyBillable(full, [{ type: "customer_final", amount: 307.8 }]), true);
    assert.equal(canMarkJobCompletedFinancially(full, [{ type: "customer_final", amount: 307.8 }], []).ok, true);
    assert.equal(customerCollectionsSatisfyBillable(full, [{ type: "customer_final", amount: 300 }]), false);
  });

  it("extra charge re-derives the final balance net of the promotion", () => {
    const patch = applyCustomerExtraPatch({ ...job, customer_deposit: 100 } as Job, 50, "extras");
    assert.equal(patch.customer_final_payment, 266 + 126 - 34.2 - 100);
  });
});

describe("loadJobPromotionAmount", () => {
  it("missing column (migration 313 not applied) means no promotion", async () => {
    const fake = {
      from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: "column jobs.promotion_amount does not exist", code: "42703" } }) }) }),
    } as unknown as SupabaseClient;
    assert.equal(await loadJobPromotionAmount(fake, "job-1"), 0);
  });

  it("reads the stored amount", async () => {
    const fake = {
      from: () => ({ select: () => ({ in: async () => ({ data: [{ id: "job-1", promotion_amount: "26.60" }], error: null }) }) }),
    } as unknown as SupabaseClient;
    assert.equal(await loadJobPromotionAmount(fake, "job-1"), 26.6);
  });
});
