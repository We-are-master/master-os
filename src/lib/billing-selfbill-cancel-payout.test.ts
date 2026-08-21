import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeSelfBillAmountDue } from "@/lib/billing-selfbill-actions";
import type { Job, SelfBill } from "@/types/database";

/**
 * O caso real do G&M Services em 21/08/2026: o PDF prometia £500 e a coluna
 * "Outstanding" oferecia £300, porque o job cancelado com £200 de compensação
 * passava pelo filtro de payout e depois valia zero.
 */
const bill = { bill_origin: "partner", status: "ready_to_pay", net_payout: 500 } as unknown as SelfBill;

function job(over: Partial<Job>): Job {
  return {
    id: over.reference ?? "x",
    reference: "JOB-0000",
    status: "completed",
    partner_cost: 0,
    materials_cost: 0,
    deleted_at: null,
    partner_cancelled_at: null,
    partner_cancellation_compensation_gbp: null,
    cancellation_fee_partner_gbp: null,
    partner_cancellation_fee: null,
    ...over,
  } as unknown as Job;
}

describe("self-bill amount due", () => {
  it("pays the cancellation compensation, not the zero partner cost", () => {
    const jobs = [
      job({ id: "a", reference: "JOB-9415", status: "completed", partner_cost: 200 }),
      job({ id: "b", reference: "JOB-9438", status: "awaiting_payment", partner_cost: 100 }),
      job({ id: "c", reference: "JOB-9437", status: "completed", partner_cost: 0 }),
      job({
        id: "d",
        reference: "JOB-9436",
        status: "cancelled",
        partner_cost: 0,
        partner_cancellation_compensation_gbp: 200,
      }),
    ];
    assert.equal(computeSelfBillAmountDue(bill, jobs as never, {}), 500);
  });

  it("still ignores a cancelled job with no money attached", () => {
    const jobs = [
      job({ id: "a", reference: "JOB-9415", status: "completed", partner_cost: 200 }),
      job({ id: "d", reference: "JOB-9436", status: "cancelled", partner_cost: 0 }),
    ];
    assert.equal(computeSelfBillAmountDue(bill, jobs as never, {}), 200);
  });

  it("subtracts what the partner already received for the job", () => {
    const jobs = [job({ id: "a", reference: "JOB-9415", status: "completed", partner_cost: 200 })];
    assert.equal(computeSelfBillAmountDue(bill, jobs as never, { a: 50 }), 150);
  });
});
