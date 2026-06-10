import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UNLINKED_ATTENTION_ACCOUNT_KEY,
  buildAttentionAccountGroups,
  buildCashflowWeekly,
  buildCashflowWeekBreakdown,
  buildInvoiceLedgerAccountGroups,
} from "@/lib/billing-standalone-metrics";
import type { Bill, Invoice, SelfBill } from "@/types/database";

function inv(
  id: string,
  opts: Partial<Invoice> & { client_name: string },
): Invoice {
  return {
    id,
    reference: `INV-${id}`,
    amount: 100,
    status: "pending",
    due_date: "2026-01-01",
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

function bill(id: string, opts: Partial<Bill> = {}): Bill {
  return {
    id,
    description: "Expense",
    amount: 120,
    due_date: "2026-06-12",
    status: "approved",
    created_at: "2026-06-01T00:00:00Z",
    ...opts,
  } as Bill;
}

describe("buildAttentionAccountGroups", () => {
  it("groups open invoices by account, not by client name", () => {
    const groups = buildAttentionAccountGroups(
      [
        inv("1", { client_name: "Uly Lo", job_reference: "JOB-1", source_account_id: "acc-hk" }),
        inv("2", { client_name: "Gary M.", job_reference: "JOB-2", source_account_id: "acc-hk" }),
        inv("3", { client_name: "Tom W.", job_reference: "JOB-3", source_account_id: "acc-ct" }),
      ],
      {},
      {},
      { "acc-hk": "Housekeep", "acc-ct": "Checkatrade" },
      {},
      {},
    );

    assert.equal(groups.length, 2);
    assert.equal(groups[0]!.accountName, "Housekeep");
    assert.equal(groups[0]!.invoiceCount, 2);
    assert.equal(groups[1]!.accountName, "Checkatrade");
    assert.equal(groups[1]!.invoiceCount, 1);
  });

  it("puts unresolved invoices in a single Direct · Unlinked bucket", () => {
    const groups = buildAttentionAccountGroups(
      [
        inv("1", { client_name: "Uly Lo" }),
        inv("2", { client_name: "Gary M." }),
      ],
      {},
      {},
      {},
      {},
      {},
    );

    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.accountKey, UNLINKED_ATTENTION_ACCOUNT_KEY);
    assert.equal(groups[0]!.accountName, "Direct · Unlinked");
    assert.equal(groups[0]!.invoiceCount, 2);
    assert.equal(groups[0]!.rows[0]!.clientName, "Uly Lo");
  });

  it("excludes draft and on_hold invoices from Money In groups", () => {
    const groups = buildAttentionAccountGroups(
      [
        inv("1", { client_name: "A", status: "draft" }),
        inv("2", { client_name: "B", status: "on_hold" }),
        inv("3", { client_name: "C", status: "pending" }),
      ],
      {},
      {},
      {},
      {},
      {},
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.invoiceCount, 1);
  });
});

describe("buildInvoiceLedgerAccountGroups", () => {
  it("groups ledger invoices by account regardless of status", () => {
    const groups = buildInvoiceLedgerAccountGroups(
      [
        inv("1", { client_name: "A", source_account_id: "acc-ct", status: "draft" }),
        inv("2", { client_name: "B", source_account_id: "acc-ct", status: "awaiting_payment" }),
        inv("3", { client_name: "C", source_account_id: "acc-hk", status: "pending" }),
      ],
      { "acc-hk": "Housekeep", "acc-ct": "Checkatrade" },
      {},
      {},
    );

    assert.equal(groups.length, 2);
    assert.equal(groups[0]!.accountName, "Checkatrade");
    assert.equal(groups[0]!.invoiceCount, 2);
    assert.equal(groups[1]!.accountName, "Housekeep");
    assert.equal(groups[1]!.invoiceCount, 1);
  });

  it("keeps unlinked invoices in Direct · Unlinked", () => {
    const groups = buildInvoiceLedgerAccountGroups(
      [inv("1", { client_name: "Direct client" })],
      {},
      {},
      {},
    );

    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.accountKey, UNLINKED_ATTENTION_ACCOUNT_KEY);
    assert.equal(groups[0]!.accountName, "Direct · Unlinked");
  });
});

describe("buildCashflowWeekly", () => {
  it("aggregates open invoice balances into Mon–Sun week buckets", () => {
    const weeks = buildCashflowWeekly({
      invoices: [
        inv("a", {
          client_name: "Acme",
          due_date: "2026-06-12",
          amount: 2574.7,
          status: "partially_paid",
          amount_paid: 0,
        }),
      ],
      selfBills: [],
      jobsByRef: {},
      customerPaidByJobId: {},
      jobsBySelfBillId: {},
      partnerPaidByJobId: {},
      dueCtx: {},
      startYmd: "2026-06-08",
      endYmd: "2026-06-14",
    });

    assert.equal(weeks.length, 1);
    assert.equal(weeks[0]!.weekStart, "2026-06-08");
    assert.equal(weeks[0]!.moneyIn, 2574.7);
    assert.equal(weeks[0]!.moneyOut, 0);
  });

  it("counts only approved self-bills in moneyOut, not pending ready rows", () => {
    const weeks = buildCashflowWeekly({
      invoices: [],
      selfBills: [
        sb("pending", { net_payout: 8000, due_date: "2026-06-10", approved_at: null }),
        sb("approved", { net_payout: 500, due_date: "2026-06-10", approved_at: "2026-06-01T10:00:00Z" }),
      ],
      jobsByRef: {},
      customerPaidByJobId: {},
      jobsBySelfBillId: {},
      partnerPaidByJobId: {},
      dueCtx: {},
      startYmd: "2026-06-08",
      endYmd: "2026-06-14",
    });

    assert.equal(weeks.length, 1);
    assert.equal(weeks[0]!.moneyOut, 500);
  });

  it("includes open bills with due_date in the week in moneyOut", () => {
    const weeks = buildCashflowWeekly({
      invoices: [],
      selfBills: [],
      bills: [
        bill("open", { amount: 250, due_date: "2026-06-11", status: "submitted" }),
        bill("paid", { amount: 999, due_date: "2026-06-11", status: "paid" }),
        bill("later", { amount: 100, due_date: "2026-06-20", status: "approved" }),
      ],
      jobsByRef: {},
      customerPaidByJobId: {},
      jobsBySelfBillId: {},
      partnerPaidByJobId: {},
      dueCtx: {},
      startYmd: "2026-06-08",
      endYmd: "2026-06-14",
    });

    assert.equal(weeks[0]!.moneyOut, 250);
  });

  it("buildCashflowWeekBreakdown lists line items for the selected week", () => {
    const breakdown = buildCashflowWeekBreakdown("2026-06-08", {
      invoices: [
        inv("a", {
          client_name: "Acme",
          due_date: "2026-06-12",
          amount: 1000,
          status: "pending",
        }),
      ],
      selfBills: [
        sb("sb1", {
          due_date: "2026-06-10",
          approved_at: "2026-06-01T10:00:00Z",
          net_payout: 500,
          partner_name: "Partner A",
        }),
      ],
      bills: [
        bill("b1", { amount: 80, due_date: "2026-06-11", description: "Rent", status: "approved" }),
      ],
      jobsByRef: {},
      customerPaidByJobId: {},
      jobsBySelfBillId: {},
      partnerPaidByJobId: {},
      dueCtx: {},
    });

    assert.equal(breakdown.inLines.length, 1);
    assert.equal(breakdown.inLines[0]!.label, "Acme");
    assert.equal(breakdown.outLines.length, 2);
    assert.equal(breakdown.moneyIn, 1000);
    assert.equal(breakdown.moneyOut, 580);
  });
});
