import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UNLINKED_ATTENTION_ACCOUNT_KEY,
  buildAttentionAccountGroups,
  buildCashflowWeekly,
  buildInvoiceLedgerAccountGroups,
} from "@/lib/billing-standalone-metrics";
import type { Invoice } from "@/types/database";

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
});
