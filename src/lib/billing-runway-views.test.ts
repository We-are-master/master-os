import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCashflowWeekly } from "@/lib/billing-standalone-metrics";
import {
  applyCashRunwayBalances,
  buildAccrualRunwayWeekly,
  buildCashRunwayWeekly,
  buildProjectionRunwayWeekly,
  buildRunwayWeekly,
} from "@/lib/billing-runway-views";
import type { CustomerPaymentRow } from "@/lib/billing-invoice-list-data";
import type { PayrollRunwayRow } from "@/lib/billing-standalone-fetch";
import type { Invoice, SelfBill } from "@/types/database";

const emptyArgs = {
  jobsByRef: {},
  customerPaidByJobId: {},
  jobsBySelfBillId: {},
  partnerPaidByJobId: {},
  dueCtx: {},
};

function inv(id: string, opts: Partial<Invoice> & { client_name: string }): Invoice {
  return {
    id,
    reference: `INV-${id}`,
    amount: 100,
    status: "pending",
    due_date: "2026-06-12",
    created_at: "2026-01-01T00:00:00Z",
    collection_stage: "awaiting_final",
    ...opts,
  };
}

function sb(id: string, opts: Partial<SelfBill> = {}): SelfBill {
  return {
    id,
    reference: `SB-${id}`,
    status: "ready_to_pay",
    net_payout: 500,
    due_date: "2026-06-12",
    week_start: "2026-06-02",
    week_end: "2026-06-08",
    created_at: "2026-06-01T00:00:00Z",
    ...opts,
  } as SelfBill;
}

describe("buildProjectionRunwayWeekly", () => {
  it("includes draft and open invoices in the same week", () => {
    const weeks = buildProjectionRunwayWeekly({
      invoices: [
        inv("draft", { client_name: "A", status: "draft", amount: 8280, due_date: "2026-06-18" }),
        inv("sent", { client_name: "B", status: "pending", amount: 2000, due_date: "2026-06-18" }),
      ],
      selfBills: [],
      bills: [],
      ...emptyArgs,
      startYmd: "2026-06-16",
      weekCount: 1,
    });
    assert.equal(weeks.length, 1);
    assert.equal(weeks[0]!.moneyIn, 10280);
  });

  it("includes P&L self-bills and payroll in money out", () => {
    const payroll: PayrollRunwayRow[] = [
      { id: "p1", label: "Payroll", amount: 1500, dueYmd: "2026-06-18" },
    ];
    const weeks = buildProjectionRunwayWeekly({
      invoices: [],
      selfBills: [
        sb("ready", { status: "ready_to_pay", net_payout: 850, due_date: "2026-06-18", approved_at: "2026-06-01T10:00:00Z" }),
        sb("draft", { status: "draft", net_payout: 790, due_date: "2026-06-25" }),
      ],
      bills: [],
      payrollRunwayRows: payroll,
      ...emptyArgs,
      startYmd: "2026-06-16",
      weekCount: 1,
    });
    assert.equal(weeks[0]!.moneyOut, 2350);
  });

  it("projects scheduled jobs without invoice by expected due week", () => {
    const weeks = buildProjectionRunwayWeekly({
      invoices: [],
      selfBills: [],
      bills: [],
      pipelineJobs: [
        {
          id: "job-1",
          reference: "JOB-100",
          client_id: "client-1",
          client_name: "StyleSmith",
          client_price: 5000,
          extras_amount: 0,
          scheduled_date: "2026-06-10",
          scheduled_start_at: null,
          status: "scheduled",
        },
      ],
      clientIdToAccountId: { "client-1": "acc-1" },
      accountTermsById: { "acc-1": "Net 30" },
      ...emptyArgs,
      startYmd: "2026-06-09",
      weekCount: 6,
    });
    const withRevenue = weeks.find((w) => w.moneyIn > 0);
    assert.ok(withRevenue);
    assert.equal(withRevenue!.moneyIn, 5000);
  });

  it("carry-forward: large in week 1 offsets distributed costs", () => {
    const weeks = applyCashRunwayBalances(
      [
        {
          weekStart: "2026-06-09",
          label: "Wk 24",
          dayNum: "9–15 Jun",
          title: "9–15 Jun 2026",
          moneyIn: 100000,
          moneyOut: 10000,
          isCurrentWeek: false,
        },
        {
          weekStart: "2026-06-16",
          label: "Wk 25",
          dayNum: "16–22 Jun",
          title: "16–22 Jun 2026",
          moneyIn: 0,
          moneyOut: 90000,
          isCurrentWeek: true,
        },
      ],
      { defaultOpening: 0, weekOverrides: {} },
    );
    assert.equal(weeks[0]!.closingBalance, 90000);
    assert.equal(weeks[1]!.closingBalance, 0);
  });
});

describe("buildAccrualRunwayWeekly", () => {
  it("delegates to projection builder with carry-forward when configured", () => {
    const weeks = buildAccrualRunwayWeekly({
      invoices: [inv("d", { client_name: "A", status: "draft", amount: 1000, due_date: "2026-06-12" })],
      selfBills: [],
      bills: [],
      cashBalanceOptions: { defaultOpening: 5000, weekOverrides: {} },
      ...emptyArgs,
      startYmd: "2026-06-09",
      weekCount: 1,
    });
    assert.equal(weeks[0]!.openingBalance, 5000);
    assert.equal(weeks[0]!.closingBalance, 6000);
  });
});

describe("buildCashRunwayWeekly", () => {
  it("buckets customer payments by payment_date", () => {
    const rows: CustomerPaymentRow[] = [
      { id: "p1", jobId: "j1", amount: 590, paymentDate: "2026-06-17", type: "customer_deposit" },
    ];
    const weeks = buildCashRunwayWeekly({
      invoices: [],
      selfBills: [],
      bills: [],
      customerPaymentRows: rows,
      ...emptyArgs,
      startYmd: "2026-06-16",
      weekCount: 1,
    });
    assert.equal(weeks[0]!.moneyIn, 590);
  });
});

describe("buildRunwayWeekly pl regression", () => {
  it("matches buildCashflowWeekly for pl view", () => {
    const args = {
      invoices: [inv("1", { client_name: "Client", status: "pending", amount: 500, due_date: "2026-06-12" })],
      selfBills: [],
      bills: [],
      ...emptyArgs,
      startYmd: "2026-06-09",
      endYmd: "2026-06-15",
      weekCount: 1,
    };
    const pl = buildCashflowWeekly(args);
    const runway = buildRunwayWeekly("pl", args);
    assert.deepEqual(runway, pl);
  });
});
