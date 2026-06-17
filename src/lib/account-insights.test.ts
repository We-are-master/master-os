import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAccountRevenueRankMap,
  computeAccountRelationshipInsights,
  sumLegacyRevenueMap,
} from "./account-insights";
import type { AccountLegacyYearlyStat, Job } from "@/types/database";

function job(partial: Partial<Job> & Pick<Job, "id" | "status">): Job {
  return {
    reference: "J-1",
    title: "Test",
    client_name: "Acme",
    property_address: "1 High St",
    progress: 100,
    current_phase: 1,
    total_phases: 1,
    client_price: 0,
    partner_cost: 0,
    materials_cost: 0,
    margin_percent: 0,
    customer_deposit: 0,
    customer_deposit_paid: false,
    customer_final_payment: 0,
    customer_final_paid: false,
    partner_payment_1: 0,
    partner_payment_1_paid: false,
    partner_payment_2: 0,
    partner_payment_2_paid: false,
    partner_payment_3: 0,
    partner_payment_3_paid: false,
    cash_in: 0,
    cash_out: 0,
    expenses: 0,
    commission: 0,
    vat: 0,
    partner_agreed_value: 0,
    finance_status: "unpaid",
    service_value: 0,
    report_submitted: false,
    report_1_uploaded: false,
    report_1_approved: false,
    report_2_uploaded: false,
    report_2_approved: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-06-01T00:00:00Z",
    ...partial,
  };
}

function legacyRow(partial: Partial<AccountLegacyYearlyStat>): AccountLegacyYearlyStat {
  return {
    id: "leg-1",
    account_id: "acc-1",
    year: 2024,
    completed_jobs_count: 10,
    revenue_gbp: 5000,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("computeAccountRelationshipInsights", () => {
  it("uses account created_at year when no legacy rows", () => {
    const result = computeAccountRelationshipInsights({
      legacyRows: [],
      jobs: [],
      accountCreatedAt: "2025-03-15T10:00:00Z",
    });
    assert.equal(result.customerSinceYear, 2025);
    assert.equal(result.totalJobsAllTime, 0);
    assert.equal(result.totalRevenueAllTime, 0);
    assert.equal(result.avgTicket, 0);
  });

  it("combines legacy and OS completed jobs for totals and avg ticket", () => {
    const result = computeAccountRelationshipInsights({
      legacyRows: [legacyRow({ completed_jobs_count: 100, revenue_gbp: 40000 })],
      jobs: [
        job({
          id: "j1",
          status: "completed",
          client_price: 200,
          extras_amount: 50,
          updated_at: "2025-08-01T00:00:00Z",
        }),
        job({
          id: "j2",
          status: "completed",
          client_price: 300,
          updated_at: "2025-09-01T00:00:00Z",
        }),
        job({ id: "j3", status: "awaiting_payment", client_price: 999 }),
      ],
      accountCreatedAt: "2025-01-01T00:00:00Z",
    });

    assert.equal(result.customerSinceYear, 2024);
    assert.equal(result.legacyJobs, 100);
    assert.equal(result.legacyRevenue, 40000);
    assert.equal(result.osCompletedJobs, 2);
    assert.equal(result.osCompletedRevenue, 550);
    assert.equal(result.totalJobsAllTime, 102);
    assert.equal(result.totalRevenueAllTime, 40550);
    assert.equal(result.avgTicket, 40550 / 102);
  });

  it("emits separate year rows for legacy and OS in the same calendar year", () => {
    const result = computeAccountRelationshipInsights({
      legacyRows: [legacyRow({ year: 2024, completed_jobs_count: 50, revenue_gbp: 20000 })],
      jobs: [
        job({
          id: "j1",
          status: "completed",
          client_price: 100,
          updated_at: "2024-11-01T00:00:00Z",
        }),
      ],
      accountCreatedAt: "2024-01-01T00:00:00Z",
    });

    assert.equal(result.yearRows.length, 2);
    assert.equal(result.yearRows[0].year, 2024);
    assert.equal(result.yearRows[0].source, "previous_system");
    assert.equal(result.yearRows[0].jobs, 50);
    assert.equal(result.yearRows[1].source, "master_os");
    assert.equal(result.yearRows[1].jobs, 1);
    assert.equal(result.yearRows[1].revenue, 100);
  });
});

describe("buildAccountRevenueRankMap", () => {
  it("ranks by OS + legacy revenue across the full set", () => {
    const ranks = buildAccountRevenueRankMap(
      [
        { id: "a", total_revenue: 5000 },
        { id: "b", total_revenue: 2000 },
        { id: "c", total_revenue: 10000 },
      ],
      { b: 90000 },
    );
    assert.equal(ranks.get("b"), 1);
    assert.equal(ranks.get("c"), 2);
    assert.equal(ranks.get("a"), 3);
  });
});

describe("sumLegacyRevenueMap", () => {
  it("sums all legacy values", () => {
    assert.equal(sumLegacyRevenueMap({ a: 100, b: 50.5 }), 150.5);
  });
});
